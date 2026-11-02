# SupportOS Terms of Service & Privacy Policy Drafts

## 1. Terms of Service Summary (Commercial SaaS)

### 1.1 Subscription & Billing
- Customers subscribe to SupportOS under Team, Business, or Enterprise tiers billed on a monthly or annual per-seat basis.
- Invoices are generated in Indian Rupees (INR) with Goods and Services Tax (GST) breakdown or international USD equivalent.
- Additional seats added mid-cycle are billed on a prorated basis.

### 1.2 Multi-Tenant Data Sovereignty
- Customer data is strictly segregated per organization.
- SupportOS employees access tenant data solely upon authorized technical support tickets with strict audit trails.
- Tenants retain 100% intellectual property ownership of their customer communications, tickets, internal notes, and knowledge articles.

---

## 2. Privacy Policy Summary (DPDP Act India & GDPR Aligned)

### 2.1 Information Collected
- **Account Information**: Name, work email address, hashed passwords, company name.
- **Support Data**: Conversations, messages, attachments, visitor IP addresses, and customer profiles processed on behalf of the subscriber.
- **Cookies & Sessions**: Strict HttpOnly session cookies used solely for authentication and CSRF defense; no third-party tracking or advertising cookies.

### 2.2 Data Retention & Deletion (Right to Be Forgotten)
- Organizations can initiate a complete JSON export of all conversations, tickets, and customer records via `/api/v1/organizations/export`.
- Deletion requests result in permanent cascade deletion from primary databases and automated purging from rolling backups within 30 days.

### 2.3 Visitor Privacy in Embeddable Widget
- The widget assigns an ephemeral pseudonymous visitor token stored in browser localStorage.
- No cross-site tracking or third-party ad profiling is performed.
