#![cfg(test)]

use soroban_sdk::{
    testutils::{storage::Persistent, Address as _, Events, Ledger},
    xdr, Address, BytesN, Env,
};

use crate::{storage::TTL_EXTEND_TO, Error, Record, Registry, RegistryClient};

const TESTNET: [u8; 32] = [0xCE; 32];
const PUBNET: [u8; 32] = [0x7A; 32];

struct Harness<'a> {
    env: Env,
    client: RegistryClient<'a>,
    id: Address,
    admin: Address,
    token: Address,
    deployment: Address,
}

impl Harness<'_> {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_network_id(TESTNET);
        env.ledger().with_mut(|l| l.sequence_number = 1_000);

        let admin = Address::generate(&env);
        let id = env.register(Registry, (admin.clone(),));
        Self {
            client: RegistryClient::new(&env, &id),
            id,
            admin,
            token: Address::generate(&env),
            deployment: Address::generate(&env),
            env,
        }
    }

    fn net(&self, id: [u8; 32]) -> BytesN<32> {
        BytesN::from_array(&self.env, &id)
    }
}

#[test]
fn a_registered_token_resolves_to_its_deployment() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    assert_eq!(h.client.resolve(&h.token), h.deployment);
    assert_eq!(
        h.client.record(&h.token),
        Some(Record {
            deployment: h.deployment.clone(),
            network_id: h.net(TESTNET),
            registered_at: 1_000,
        })
    );
}

// --- the three refusals the award is checked against --------------------

#[test]
fn an_unregistered_token_does_not_resolve() {
    let h = Harness::new();
    assert_eq!(
        h.client.try_resolve(&h.token),
        Err(Ok(Error::NotRegistered))
    );
}

#[test]
fn a_record_for_another_network_does_not_resolve() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(PUBNET));
    assert_eq!(h.client.try_resolve(&h.token), Err(Ok(Error::WrongNetwork)));
}

#[test]
fn a_write_from_a_non_admin_is_rejected() {
    let h = Harness::new();
    let stranger = Address::generate(&h.env);
    assert_eq!(
        h.client
            .try_register(&stranger, &h.token, &h.deployment, &h.net(TESTNET)),
        Err(Ok(Error::NotAdmin))
    );
    assert_eq!(h.client.record(&h.token), None);
}

// --- the rest of the write path ---------------------------------------

#[test]
fn the_caller_must_authorize_the_write() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    let auths = h.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, h.admin);
}

#[test]
#[should_panic]
fn a_forged_admin_write_without_its_signature_fails() {
    let h = Harness::new();
    h.env.mock_auths(&[]);
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
}

#[test]
fn re_registering_replaces_the_deployment() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    let replacement = Address::generate(&h.env);
    h.client
        .register(&h.admin, &h.token, &replacement, &h.net(TESTNET));
    assert_eq!(h.client.resolve(&h.token), replacement);
}

#[test]
fn every_registration_and_change_emits_an_event() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    assert_eq!(previous_in_last_event(&h), xdr::ScVal::Void);

    let replacement = Address::generate(&h.env);
    h.client
        .register(&h.admin, &h.token, &replacement, &h.net(TESTNET));
    assert_eq!(previous_in_last_event(&h), xdr::ScVal::from(&h.deployment));
}

/// The `previous` field of the single event the last call emitted.
fn previous_in_last_event(h: &Harness) -> xdr::ScVal {
    let all = h.env.events().all();
    let events = all.filter_by_contract(&h.id);
    assert_eq!(events.events().len(), 1);
    let xdr::ContractEventBody::V0(body) = &events.events()[0].body;
    let xdr::ScVal::Map(Some(map)) = &body.data else {
        panic!("event data is a map");
    };
    map.iter()
        .find(|entry| entry.key == xdr::ScVal::Symbol("previous".try_into().unwrap()))
        .map(|entry| entry.val.clone())
        .expect("event carries previous")
}

#[test]
fn unregistering_removes_the_record() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    h.client.unregister(&h.admin, &h.token);
    assert_eq!(
        h.client.try_resolve(&h.token),
        Err(Ok(Error::NotRegistered))
    );
    assert_eq!(
        h.client.try_unregister(&h.admin, &h.token),
        Err(Ok(Error::NotRegistered))
    );
}

#[test]
fn a_non_admin_cannot_unregister() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    let stranger = Address::generate(&h.env);
    assert_eq!(
        h.client.try_unregister(&stranger, &h.token),
        Err(Ok(Error::NotAdmin))
    );
    assert_eq!(h.client.resolve(&h.token), h.deployment);
}

#[test]
fn the_admin_can_be_rotated_and_the_old_key_loses_write_access() {
    let h = Harness::new();
    let next = Address::generate(&h.env);
    h.client.set_admin(&h.admin, &next);
    assert_eq!(h.client.admin(), next);
    assert_eq!(
        h.client
            .try_register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET)),
        Err(Ok(Error::NotAdmin))
    );
    h.client
        .register(&next, &h.token, &h.deployment, &h.net(TESTNET));
}

#[test]
fn a_record_lives_a_month_after_it_is_written() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    let ttl = h.env.as_contract(&h.id, || {
        h.env
            .storage()
            .persistent()
            .get_ttl(&crate::storage::DataKey::Record(h.token.clone()))
    });
    assert_eq!(ttl, TTL_EXTEND_TO);
}

#[test]
fn resolving_extends_a_record_that_is_running_low() {
    let h = Harness::new();
    h.client
        .register(&h.admin, &h.token, &h.deployment, &h.net(TESTNET));
    h.env
        .ledger()
        .with_mut(|l| l.sequence_number += TTL_EXTEND_TO - 100);
    h.client.resolve(&h.token);
    let ttl = h.env.as_contract(&h.id, || {
        h.env
            .storage()
            .persistent()
            .get_ttl(&crate::storage::DataKey::Record(h.token.clone()))
    });
    assert_eq!(ttl, TTL_EXTEND_TO);
}
