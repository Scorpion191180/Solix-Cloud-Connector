# Solix-Cloud-Connector

## Audi Connect (Phase 1)

The optional `GET /api/audi` endpoint provides read-only data for the first
vehicle in the myAudi account. Add these environment variables in Render:

```text
AUDI_EMAIL=your-myaudi-email
AUDI_PASSWORD=your-myaudi-password
AUDI_COUNTRY=DE
```

`AUDI_SPIN` is optional and is not required for read-only vehicle data. Audi
data is cached for 15 minutes so browser refreshes do not repeatedly call the
Audi cloud. The existing Solix endpoints are unchanged.
