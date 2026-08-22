import type { Group, LedgerMember, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        group: Group;
        /// The caller's Ledger+ partnership membership. Present on every authenticated
        /// request - requireAuth() rejects a Trackmarg user who is not a Ledger+ partner.
        member: LedgerMember;
        groupId: string;
        groupCode: string;
        tokenHash: string;
      };
    }
  }
}

export {};
