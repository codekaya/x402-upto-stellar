use soroban_sdk::{contracttype, Address, BytesN};

/// A registry entry: the canonical `upto` deployment for one token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Record {
    /// The `upto` escrow contract payments in this token should authorize.
    pub deployment: Address,
    /// SHA-256 of the passphrase of the network the deployment belongs to.
    /// `resolve` refuses the record on any other network.
    pub network_id: BytesN<32>,
    /// Ledger sequence of the registration that wrote this record.
    pub registered_at: u32,
}
