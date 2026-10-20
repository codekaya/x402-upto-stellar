use soroban_sdk::{contracttype, Address, Env};

use crate::types::Record;

/// Ledgers per day at the nominal 5-second close time.
const DAY_IN_LEDGERS: u32 = 17_280;

/// Records and the instance are extended to this TTL whenever they are
/// written or resolved and have fallen below the threshold. A registry that is
/// read at least once a month never archives; one that goes quiet longer is
/// restored automatically by the next transaction that touches it.
pub const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
pub const TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The address allowed to write records. Instance storage.
    Admin,
    /// The record for a token. Persistent storage.
    Record(Address),
}

pub fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin is set by the constructor")
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn record(env: &Env, token: &Address) -> Option<Record> {
    env.storage()
        .persistent()
        .get(&DataKey::Record(token.clone()))
}

pub fn bump_record(env: &Env, token: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::Record(token.clone()),
        TTL_THRESHOLD,
        TTL_EXTEND_TO,
    );
}

pub fn save_record(env: &Env, token: &Address, record: &Record) {
    env.storage()
        .persistent()
        .set(&DataKey::Record(token.clone()), record);
    bump_record(env, token);
}

pub fn remove_record(env: &Env, token: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Record(token.clone()));
}
