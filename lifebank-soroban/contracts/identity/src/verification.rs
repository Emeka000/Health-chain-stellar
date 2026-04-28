use soroban_sdk::{contracttype, symbol_short, Address, Env, String, Symbol, Vec};

use crate::{DataKey, Error, Organization};

/// Verification metadata for tracking on-chain verification state
#[contracttype]
#[derive(Clone, Debug)]
pub struct VerificationMetadata {
    pub org_id: Address,
    pub verified: bool,
    pub verified_at: Option<u64>,
    pub verified_by: Option<Address>,
    pub revoked_at: Option<u64>,
    pub revocation_reason: Option<String>,
}

/// Verification event for audit trail
#[contracttype]
#[derive(Clone, Debug)]
pub struct VerificationEvent {
    pub org_id: Address,
    pub event_type: String, // "verified" or "revoked"
    pub timestamp: u64,
    pub actor: Address,
    pub reason: Option<String>,
}

pub trait VerificationTrait {
    /// Verify an organization (admin only)
    /// Returns the verification metadata
    fn verify_organization(
        env: Env,
        admin: Address,
        org_id: Address,
    ) -> Result<VerificationMetadata, Error>;

    /// Unverify/revoke an organization (admin only)
    /// Returns the verification metadata
    fn unverify_organization(
        env: Env,
        admin: Address,
        org_id: Address,
        reason: String,
    ) -> Result<VerificationMetadata, Error>;

    /// Get verification metadata for an organization
    fn get_verification_metadata(env: Env, org_id: Address) -> Result<VerificationMetadata, Error>;

    /// Check if organization is verified
    fn is_organization_verified(env: Env, org_id: Address) -> Result<bool, Error>;

    /// Get verification timestamp
    fn get_verification_timestamp(env: Env, org_id: Address) -> Result<Option<u64>, Error>;

    /// Get verification event history (last N events)
    fn get_verification_events(
        env: Env,
        org_id: Address,
        limit: u32,
    ) -> Result<Vec<VerificationEvent>, Error>;

    /// Batch verify organizations (admin only)
    fn batch_verify_organizations(
        env: Env,
        admin: Address,
        org_ids: Vec<Address>,
    ) -> Result<u32, Error>;

    /// Batch revoke organizations (admin only)
    fn batch_revoke_organizations(
        env: Env,
        admin: Address,
        org_ids: Vec<Address>,
        reason: String,
    ) -> Result<u32, Error>;
}

pub struct VerificationImpl;

impl VerificationTrait for VerificationImpl {
    fn verify_organization(
        env: Env,
        admin: Address,
        org_id: Address,
    ) -> Result<VerificationMetadata, Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let org_key = DataKey::Org(org_id.clone());
        let mut organization: Organization = env
            .storage()
            .persistent()
            .get(&org_key)
            .ok_or(Error::OrganizationNotFound)?;

        if organization.verified {
            return Err(Error::AlreadyVerified);
        }

        let now = env.ledger().timestamp();
        organization.verified = true;
        organization.verified_timestamp = Some(now);

        env.storage().persistent().set(&org_key, &organization);

        // Store verification metadata
        let metadata = VerificationMetadata {
            org_id: org_id.clone(),
            verified: true,
            verified_at: Some(now),
            verified_by: Some(admin.clone()),
            revoked_at: None,
            revocation_reason: None,
        };

        let metadata_key = DataKey::VerificationMetadata(org_id.clone());
        env.storage().persistent().set(&metadata_key, &metadata);

        // Record verification event
        Self::record_verification_event(
            &env,
            &org_id,
            String::from_str(&env, "verified"),
            now,
            &admin,
            None,
        );

        env.events().publish(
            (Symbol::new(&env, "org_verified"), symbol_short!("v1")),
            (org_id.clone(), admin, now),
        );

        Ok(metadata)
    }

    fn unverify_organization(
        env: Env,
        admin: Address,
        org_id: Address,
        reason: String,
    ) -> Result<VerificationMetadata, Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let org_key = DataKey::Org(org_id.clone());
        let mut organization: Organization = env
            .storage()
            .persistent()
            .get(&org_key)
            .ok_or(Error::OrganizationNotFound)?;

        if !organization.verified {
            return Err(Error::AlreadyUnverified);
        }

        let now = env.ledger().timestamp();
        organization.verified = false;
        organization.verified_timestamp = None;

        env.storage().persistent().set(&org_key, &organization);

        // Update verification metadata
        let metadata = VerificationMetadata {
            org_id: org_id.clone(),
            verified: false,
            verified_at: None,
            verified_by: None,
            revoked_at: Some(now),
            revocation_reason: Some(reason.clone()),
        };

        let metadata_key = DataKey::VerificationMetadata(org_id.clone());
        env.storage().persistent().set(&metadata_key, &metadata);

        // Record revocation event
        Self::record_verification_event(
            &env,
            &org_id,
            String::from_str(&env, "revoked"),
            now,
            &admin,
            Some(reason.clone()),
        );

        env.events().publish(
            (Symbol::new(&env, "org_unverified"), symbol_short!("v1")),
            (org_id.clone(), reason),
        );

        Ok(metadata)
    }

    fn get_verification_metadata(env: Env, org_id: Address) -> Result<VerificationMetadata, Error> {
        let metadata_key = DataKey::VerificationMetadata(org_id.clone());
        env.storage()
            .persistent()
            .get(&metadata_key)
            .ok_or(Error::OrganizationNotFound)
    }

    fn is_organization_verified(env: Env, org_id: Address) -> Result<bool, Error> {
        let org_key = DataKey::Org(org_id);
        let org: Organization = env
            .storage()
            .persistent()
            .get(&org_key)
            .ok_or(Error::OrganizationNotFound)?;

        Ok(org.verified)
    }

    fn get_verification_timestamp(env: Env, org_id: Address) -> Result<Option<u64>, Error> {
        let org_key = DataKey::Org(org_id);
        let org: Organization = env
            .storage()
            .persistent()
            .get(&org_key)
            .ok_or(Error::OrganizationNotFound)?;

        Ok(org.verified_timestamp)
    }

    fn get_verification_events(
        env: Env,
        org_id: Address,
        limit: u32,
    ) -> Result<Vec<VerificationEvent>, Error> {
        let events_key = DataKey::VerificationEvents(org_id);
        let all_events: Vec<VerificationEvent> = env
            .storage()
            .persistent()
            .get(&events_key)
            .unwrap_or(Vec::new(&env));

        let take = limit.min(all_events.len());
        let mut results = Vec::new(&env);

        // Return last N events (reverse order)
        let start = all_events.len().saturating_sub(take);

        for i in start..all_events.len() {
            results.push_back(all_events.get(i).unwrap());
        }

        Ok(results)
    }

    fn batch_verify_organizations(
        env: Env,
        admin: Address,
        org_ids: Vec<Address>,
    ) -> Result<u32, Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let mut verified_count = 0u32;

        for i in 0..org_ids.len() {
            let org_id = org_ids.get(i).unwrap();
            if let Ok(_) = Self::verify_organization(env.clone(), admin.clone(), org_id) {
                verified_count += 1;
            }
        }

        Ok(verified_count)
    }

    fn batch_revoke_organizations(
        env: Env,
        admin: Address,
        org_ids: Vec<Address>,
        reason: String,
    ) -> Result<u32, Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;

        let mut revoked_count = 0u32;

        for i in 0..org_ids.len() {
            let org_id = org_ids.get(i).unwrap();
            if let Ok(_) =
                Self::unverify_organization(env.clone(), admin.clone(), org_id, reason.clone())
            {
                revoked_count += 1;
            }
        }

        Ok(revoked_count)
    }
}

impl VerificationImpl {
    fn require_admin(env: &Env, account: &Address) -> Result<(), Error> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)?;

        if account == &stored_admin {
            Ok(())
        } else {
            Err(Error::Unauthorized)
        }
    }

    fn record_verification_event(
        env: &Env,
        org_id: &Address,
        event_type: String,
        timestamp: u64,
        actor: &Address,
        reason: Option<String>,
    ) {
        let event = VerificationEvent {
            org_id: org_id.clone(),
            event_type,
            timestamp,
            actor: actor.clone(),
            reason,
        };

        let events_key = DataKey::VerificationEvents(org_id.clone());
        let mut events: Vec<VerificationEvent> = env
            .storage()
            .persistent()
            .get(&events_key)
            .unwrap_or(Vec::new(env));

        events.push_back(event);
        env.storage().persistent().set(&events_key, &events);
    }
}
