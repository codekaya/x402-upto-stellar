use soroban_sdk::contracterror;

/// One error per refusal reason, so a client can tell them apart.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No record exists for this token.
    NotRegistered = 1,
    /// The record was registered for a different network than the one this
    /// ledger belongs to.
    WrongNetwork = 2,
    /// The caller is not the registry admin.
    NotAdmin = 3,
}
