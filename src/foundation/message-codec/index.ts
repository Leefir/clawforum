/**
 * @module L1.MessageCodec
 * MessageCodec module (L1)
 *
 * Inbox/outbox message encode/decode. Pure functions only: no I/O, no side effects.
 *
 * No runtime dependencies.
 */

// Frontmatter parser (general purpose)
export { parseFrontmatter } from './frontmatter.js';

// Validation
export { validatePriority, validateType, VALID_PRIORITIES, VALID_TYPES } from './validation.js';

// Inbox encode/decode
export { encodeInbox, decodeInbox } from './inbox.js';

// Outbox encode
export { encodeOutbox } from './outbox.js';
