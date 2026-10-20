#![no_std]
//! Spike 2 probe: what a contract sees as its network identity, and whether a
//! refusal keyed on it can be landed on-chain with a transaction hash.

use soroban_sdk::{contract, contracterror, contractimpl, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    WrongNetwork = 1,
}

#[contract]
pub struct Probe;

#[contractimpl]
impl Probe {
    /// The network id exactly as the host hands it to a contract.
    pub fn network_id(env: Env) -> BytesN<32> {
        env.ledger().network_id()
    }

    /// Succeeds only on the network whose id is `expected`. The same comparison
    /// a registry record would make against the id it was registered under.
    pub fn require_network(env: Env, expected: BytesN<32>) -> Result<(), Error> {
        if env.ledger().network_id() == expected {
            Ok(())
        } else {
            Err(Error::WrongNetwork)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Ledger;

    #[test]
    fn the_id_follows_the_ledger() {
        let env = Env::default();
        let client = ProbeClient::new(&env, &env.register(Probe, ()));

        env.ledger().set_network_id([7; 32]);
        assert_eq!(client.network_id(), BytesN::from_array(&env, &[7; 32]));
        client.require_network(&BytesN::from_array(&env, &[7; 32]));

        env.ledger().set_network_id([8; 32]);
        assert_eq!(
            client.try_require_network(&BytesN::from_array(&env, &[7; 32])),
            Err(Ok(Error::WrongNetwork))
        );
    }
}
