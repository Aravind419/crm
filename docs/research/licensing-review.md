# SupportOS Licensing & Intellectual Property Review

## 1. Clean-Room Implementation Mandate

SupportOS is an independent, proprietary SaaS product built to solve customer support and customer engagement workflows.
This review establishes strict IP guidelines ensuring total compliance with software copyrights, patent laws, and open-source licenses.

---

## 2. Benchmark Products IP & Licensing Assessment

| Product | Vendor | License / Distribution Model | Permitted Reference Scope | Prohibited Actions |
| :--- | :--- | :--- | :--- | :--- |
| **Intercom** | Intercom Inc. | Proprietary Commercial Cloud | Public UI workflows, observable user journeys, marketing feature descriptions, public documentation. | Decompiling client JS bundles, copying CSS styles or SVGs, scraping proprietary icons, copying brand assets. |
| **Zendesk** | Zendesk Inc. | Proprietary Commercial Cloud | Public documentation, API contract designs (REST concepts), user workflows, industry standard ticket states. | Extracting closed source code, reproducing trademarks, duplicating proprietary UI layout pixels. |
| **Chatwoot** | Chatwoot Inc. | Dual-licensed (AGPLv3 / Enterprise Edition) | Public documentation, developer guides, public architectural concepts (e.g. channel inbox model). | Copying or copying-and-pasting any lines of AGPL code, copying Chatwoot Ruby on Rails models, reusing Chatwoot frontend Vue code. |

---

## 3. SupportOS Third-Party Dependency Licensing Policy

All open-source libraries and frameworks incorporated into SupportOS must use permissive, business-friendly licenses:

| Permitted License | Acceptable Libraries | Examples in SupportOS |
| :--- | :--- | :--- |
| **MIT License** | Allowed without restriction | Next.js, React, Tailwind CSS, Lucide Icons, Prisma, NestJS, Socket.IO, BullMQ, class-validator, Axios |
| **Apache 2.0** | Allowed with patent grant preservation | TypeScript, Docker engine |
| **BSD 2-Clause / 3-Clause** | Allowed with attribution | Go / PostgreSQL client tools |
| **ISC License** | Allowed | npm packages, glob, rimraf |

### Prohibited Licenses
- **GPL v2 / GPL v3 / AGPL v3**: Prohibited in any part of the SupportOS core codebase to prevent license contamination or forced open-sourcing of proprietary business logic.
- **SSPL / Commons Clause**: Prohibited due to commercial cloud restriction clauses.

---

## 4. Brand & Asset Isolation Verification

1. **Design System & Assets**:
   - All icons used in SupportOS are sourced from the permissive open-source **Lucide React** icon library (ISC license).
   - Color palettes, typography, spacing scales, and visual hierarchies are independently defined using standard Tailwind CSS utility scales.
   - All branding, product logos, and naming ("SupportOS") are unique and distinct from any competitor trademarks.

2. **Source Code Originality**:
   - 100% of the backend NestJS controllers, services, entities, DTOs, and frontend React components are authored from scratch.
   - Automated code scanning and linting will be enforced in CI pipelines to ensure zero unlicensed snippets are introduced.
