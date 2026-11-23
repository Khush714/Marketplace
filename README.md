# Marketplace
Restaurant marketplace 

## Customer notification inbox

The bell in the site header opens a device-wide, in-app inbox. The browser
generates one high-entropy token (`crave.inbox.v1`) and the server stores only
its SHA-256 hash on the order and each notification. There is no account lookup,
contact capture, web push, SMS or email: the token is the only capability, and
it stays in `localStorage` on this device.

The inbox polls `/api/notifications` every 15 seconds while the tab is visible,
shows a toast for new unread messages, and lets a customer mark one or all
messages read. Writes are best-effort and deduped by `(inboxHash, dedupeKey)`,
so replayed POS/payment events cannot duplicate a message or fail an order,
payment, cancellation or review.

Supported updates: order placed, order status (including cancellations),
payment state, and a kitchen reply to feedback. The migration is
`src/db/migrations/20261126_customer_notifications.sql`.
