use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::errors::Error;
use crate::types::{Organization, OrganizationType, VerificationStatus};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    Organization(Address),
    OrgCount,
    OrgList,
    OrgTypeList(OrganizationType),
    OrgTypePage(OrganizationType, u32),
    OrgTypeCount(OrganizationType),
    VerifiedOrgs,
    VerifiedOrgsPage(u32),
    VerifiedOrgsCount,
    VerificationStatus(Address),
}

// ---------------------------------------------------------------------------
// Organization storage
// ---------------------------------------------------------------------------

pub fn get_organization(env: &Env, address: &Address) -> Result<Organization, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Organization(address.clone()))
        .ok_or(Error::OrganizationNotFound)
}

pub fn set_organization(env: &Env, address: &Address, org: &Organization) {
    env.storage()
        .persistent()
        .set(&DataKey::Organization(address.clone()), org);
}

pub fn has_organization(env: &Env, address: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Organization(address.clone()))
}

// ---------------------------------------------------------------------------
// Org type paged storage
// ---------------------------------------------------------------------------

pub fn get_org_type_count(env: &Env, org_type: &OrganizationType) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::OrgTypeCount(org_type.clone()))
        .unwrap_or(0)
}

pub fn set_org_type_count(env: &Env, org_type: &OrganizationType, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::OrgTypeCount(org_type.clone()), &count);
}

pub fn get_org_type_page(env: &Env, org_type: &OrganizationType, page: u32) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::OrgTypePage(org_type.clone(), page))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_org_type_page(
    env: &Env,
    org_type: &OrganizationType,
    page: u32,
    addresses: &Vec<Address>,
) {
    env.storage()
        .persistent()
        .set(&DataKey::OrgTypePage(org_type.clone(), page), addresses);
}

/// Append an address to the paged org-type list, returning the new total count.
pub fn append_org_type(env: &Env, org_type: &OrganizationType, address: &Address) -> u32 {
    let count = get_org_type_count(env, org_type);
    let page = count / ORG_TYPE_PAGE_SIZE;
    let mut addresses = get_org_type_page(env, org_type, page);
    addresses.push_back(address.clone());
    set_org_type_page(env, org_type, page, &addresses);
    let new_count = count + 1;
    set_org_type_count(env, org_type, new_count);
    new_count
}

/// Read a window of the paged org-type list starting at `start`.
/// Returns the collected addresses and the next start cursor (or `None` when exhausted).
pub fn get_org_type_window(
    env: &Env,
    org_type: &OrganizationType,
    start: u32,
    max_results: u32,
) -> (Vec<Address>, Option<u32>) {
    let count = get_org_type_count(env, org_type);
    let mut results = Vec::new(env);
    let mut index = start;
    while index < count && results.len() < max_results {
        let page = index / ORG_TYPE_PAGE_SIZE;
        let offset = index % ORG_TYPE_PAGE_SIZE;
        let addresses = get_org_type_page(env, org_type, page);
        if offset < addresses.len() {
            results.push_back(addresses.get(offset).unwrap());
        }
        index += 1;
    }
    let next_start = if index < count { Some(index) } else { None };
    (results, next_start)
}

pub const ORG_TYPE_PAGE_SIZE: u32 = 50;
