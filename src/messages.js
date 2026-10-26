export const MSG_NOT_RUNNING = 'Start an agent session in the DogeUni wallet first.';
export const MSG_NOT_PAIRED = 'Pair first: run `dogeuni-mcp pair`.';

// Spending (P2c).
export const MSG_INSUFFICIENT_FUNDS =
  'The agent account does not have enough spendable DOGE for the amount plus the fee. Nothing was sent.';
export const MSG_BROADCAST_FAILED =
  'The transaction was signed but broadcasting it failed. It may still have reached the network, and the amount stays counted against the 24h limit. Do not retry until you have checked the chain (or the agent balance) for this transaction.';
export const MSG_BUSY = 'Another send is already waiting for the user in the wallet. Try again after it is resolved.';
export const MSG_DENIED =
  'The wallet refused the send (denied by the grant policy, or rejected by the user). Nothing was sent. Do not retry the same send unless the user changes the grant in the wallet.';
export const MSG_APPROVAL_TIMEOUT =
  'The user did not answer the approval request in the wallet within 5 minutes. Nothing was sent.';
/** Appended when submit_send loses the wallet after the request went out. */
export const MSG_SEND_OUTCOME_UNKNOWN =
  'The send may or may not have happened. Check the agent balance or the chain before trying again.';
