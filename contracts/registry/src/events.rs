use soroban_sdk::{contractevent, Address, BytesN};

/// Published whenever a record is written: a first registration has
/// `previous: None`, a change carries the deployment it replaced.
#[contractevent(topics = ["registry", "registered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registered {
    #[topic]
    pub token: Address,
    pub deployment: Address,
    pub network_id: BytesN<32>,
    pub previous: Option<Address>,
}

/// Published when a record is removed.
#[contractevent(topics = ["registry", "unregistered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unregistered {
    #[topic]
    pub token: Address,
    pub deployment: Address,
}

/// Published when the admin key is rotated.
#[contractevent(topics = ["registry", "admin_changed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub previous: Address,
    pub admin: Address,
}
