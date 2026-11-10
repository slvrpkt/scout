/** Whether an address is one nobody reads, so an answer there goes nowhere. */
export const isNoReply = (address: string) => /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|notifications?)([+@-]|$)/i.test(address.trim());
