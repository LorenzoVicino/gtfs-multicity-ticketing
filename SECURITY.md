# Security policy

## Supported versions

Only the latest stable release is supported. Earlier versions are retained for historical reference and do not receive security fixes.

## Reporting a vulnerability

Do not open a public issue containing exploitable details, credentials, tokens, or personal data. Use **Report a vulnerability** in the repository's GitHub Security tab.

When possible, include:

- the affected component and version;
- the minimum steps needed to reproduce the issue;
- the observed or potential impact;
- a proposed mitigation.

The maintainer will acknowledge the report and coordinate the fix and disclosure. Production secrets must never be committed: `.env.local` and `deploy.env` remain excluded from Git.

## Project boundary

GTFS Hub is a self-hosted demonstration project. Real public use requires, at minimum, TLS through a reverse proxy, PostgreSQL backups, secret rotation, monitoring, and an appropriate authentication and authorization service.
