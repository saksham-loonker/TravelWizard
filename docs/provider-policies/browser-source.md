# Browser Source Policy

TravelWizard treats local browser research as user-delegated reading, not as a hosted scraping loophole.

- Allowed commands: browse, goto, snapshot, text, links, table, extract, scroll, back, forward, tabs, switchTab, limited screenshot.
- Restricted click: navigation, pagination, disclosure, and filter expansion only after label classification.
- Blocked commands: type, fill, select, upload, drag, save-state, cookie export, eval, network logs, console logs.
- Blocked targets: login, account, booking, payment, confirmation, cancellation, refund, traveler details, CAPTCHA, and anti-bot bypass.
- Retention: metadata, source URLs, field confidence, timestamps, and redacted short source summaries only. Raw page snapshots, replay traces, and provider cookies are off by default.
- User deletion: local retained state can be cleared from Settings or through `DELETE /api/privacy/local-state`; pairing state is not persisted and is reset by the purge.
