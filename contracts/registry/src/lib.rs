#![no_std]
//! Discovery registry for the x402 `upto` scheme on Stellar.
//!
//! Answers one question: for this token, which `upto` deployment is canonical
//! on this network? Without it, "pay this contract" is an instruction from the
//! party being paid, and a substituted address is a stolen payment.
//!
//! The registry stores address records only, never funds. It advises; it does
//! not gate: the escrow contract never reads it, so it cannot block a
//! settlement that is already authorized. Clients and facilitators read it to
//! check the `extra.contract` a resource server advertises.
//!
//! Each record carries the network id it was registered for, and
//! [`Registry::resolve`] compares it with `env.ledger().network_id()`, so a
//! record meant for one network never resolves on another.

mod error;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use error::Error;
pub use types::Record;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct Registry;

#[contractimpl]
impl Registry {
    /// Sets the admin, the only address that may write records.
    pub fn __constructor(env: Env, admin: Address) {
        storage::set_admin(&env, &admin);
        storage::bump_instance(&env);
    }

    /// Registers or replaces the canonical deployment for `token`.
    ///
    /// `network_id` is the SHA-256 of the passphrase of the network the
    /// deployment belongs to. It is supplied rather than read from the ledger
    /// so that a record is an explicit claim the admin makes, which
    /// [`Registry::resolve`] then checks against the network it runs on.
    pub fn register(
        env: Env,
        caller: Address,
        token: Address,
        deployment: Address,
        network_id: BytesN<32>,
    ) -> Result<(), Error> {
        require_admin(&env, &caller)?;

        let previous = storage::record(&env, &token).map(|record| record.deployment);
        storage::save_record(
            &env,
            &token,
            &Record {
                deployment: deployment.clone(),
                network_id: network_id.clone(),
                registered_at: env.ledger().sequence(),
            },
        );
        storage::bump_instance(&env);

        events::Registered {
            token,
            deployment,
            network_id,
            previous,
        }
        .publish(&env);
        Ok(())
    }

    /// Removes the record for `token`.
    pub fn unregister(env: Env, caller: Address, token: Address) -> Result<(), Error> {
        require_admin(&env, &caller)?;
        let record = storage::record(&env, &token).ok_or(Error::NotRegistered)?;
        storage::remove_record(&env, &token);

        events::Unregistered {
            token,
            deployment: record.deployment,
        }
        .publish(&env);
        Ok(())
    }

    /// The canonical deployment for `token` on this network.
    ///
    /// Refuses with [`Error::NotRegistered`] when there is no record and with
    /// [`Error::WrongNetwork`] when the record was registered for another
    /// network. Extends the record's TTL, so a registry in use never archives.
    pub fn resolve(env: Env, token: Address) -> Result<Address, Error> {
        let record = storage::record(&env, &token).ok_or(Error::NotRegistered)?;
        if record.network_id != env.ledger().network_id() {
            return Err(Error::WrongNetwork);
        }
        storage::bump_record(&env, &token);
        storage::bump_instance(&env);
        Ok(record.deployment)
    }

    /// The raw record for `token`, without the network check. For inspection.
    pub fn record(env: Env, token: Address) -> Option<Record> {
        storage::record(&env, &token)
    }

    /// The current admin.
    pub fn admin(env: Env) -> Address {
        storage::admin(&env)
    }

    /// Rotates the admin key. Requires the current admin.
    pub fn set_admin(env: Env, caller: Address, admin: Address) -> Result<(), Error> {
        require_admin(&env, &caller)?;
        storage::set_admin(&env, &admin);
        storage::bump_instance(&env);

        events::AdminChanged {
            previous: caller,
            admin,
        }
        .publish(&env);
        Ok(())
    }
}

/// The caller proves control of its address, then must be the admin. Taking
/// the caller explicitly turns a non-admin write into a typed refusal rather
/// than an opaque host authorization failure.
fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    caller.require_auth();
    if *caller != storage::admin(env) {
        return Err(Error::NotAdmin);
    }
    Ok(())
}
