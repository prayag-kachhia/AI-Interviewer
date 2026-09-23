// sessions — public entry point. Other modules import only from this file.
// Owner: live-session pair. Voice tokens, transcript turns, ending a session.
// May import from: identity, profile. Never imports feedback; emits a session.ended job.
export {};
