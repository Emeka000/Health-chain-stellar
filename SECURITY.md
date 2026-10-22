# Security Policy

HealthDonor Protocol handles health-related workflows and Stellar assets. We
treat security reports as confidential and ask researchers not to disclose
vulnerabilities in public issues, pull requests, discussions, or chat rooms.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting form:

[Report a vulnerability privately](https://github.com/Emeka000/Health-chain-stellar/security/advisories/new)

Repository maintainers must enable **Private vulnerability reporting** under
**Settings → Code security and analysis** for this form to be available. The
link is kept here so contributors have one stable reporting destination after
the setting is enabled.

Include enough detail for us to reproduce and assess the issue without sharing
real patient data, private keys, credentials, or other sensitive information.
Useful details include:

- the affected component and version or commit;
- a concise description of the impact and attack scenario;
- reproduction steps or a minimal proof of concept;
- required permissions, configuration, or network conditions; and
- any suggested mitigation or workaround.

If private vulnerability reporting is unavailable, contact the repository
maintainers through [Emeka000's GitHub profile](https://github.com/Emeka000)
and request a private reporting channel. Do not include exploit details in a
public message.

## Scope

Reports are in scope for vulnerabilities affecting:

- the NestJS backend API, authentication, authorization, storage, queues, and
  integrations;
- Soroban contracts and their authorization, asset, and state-transition
  logic; and
- the frontend where a client-side issue can expose health data, credentials,
  wallet material, or user funds.

Examples of valid reports include unauthorized access to another organization,
health-data exposure, authentication or authorization bypasses, contract fund
loss or unauthorized state transitions, secret leakage, injection, and
server-side request forgery.

The following are generally out of scope unless they demonstrate a concrete
security impact: missing best-practice headers without exploitability, denial
of service against third-party infrastructure, social engineering, automated
scanner output without reproduction, and issues in dependencies that do not
affect this project.

## Response targets

These are target times, not guarantees:

| Step | Target |
|------|--------|
| Acknowledge the report | Within 3 business days |
| Initial triage and severity assessment | Within 7 business days |
| Provide a status update | At least every 14 days while investigating |
| Coordinate a fix and disclosure timeline | With the reporter after validation |

We may ask follow-up questions, request a safer proof of concept, or provide a
temporary mitigation while a fix is prepared.

## Disclosure process

Please allow maintainers reasonable time to investigate and release a fix
before public disclosure. We will coordinate the disclosure date with the
reporter, credit researchers who opt in, and avoid publishing personal data or
unnecessary exploit details. If a report is invalid or out of scope, we will
explain that outcome when possible.

## Sensitive data

Never include real patient records, production credentials, private keys,
wallet seeds, or unredacted logs in a report. Use synthetic fixtures and redact
identifiers before attaching evidence.
