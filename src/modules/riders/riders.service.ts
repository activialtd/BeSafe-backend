import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError } from '@/common/api-error';
import { newId } from '@/common/id';
import { DB, Database } from '@/db/db.module';
import { emergencyContacts } from '@/db/schema';
import { AuditService } from '@/modules/audit/audit.service';
import { ngPhone } from '@/modules/auth/auth.dto';

export const addContactDto = z.object({
  name: z.string().min(1).max(120),
  phone: ngPhone,
  relationship: z.string().max(40).optional(),
});
export type AddContactDto = z.infer<typeof addContactDto>;

export const MAX_CONTACTS = 5;

@Injectable()
export class RidersService {
  constructor(@Inject(DB) private readonly db: Database, private readonly audit: AuditService) {}

  async listContacts(userId: string) {
    return this.db.select().from(emergencyContacts).where(eq(emergencyContacts.userId, userId));
  }

  async addContact(userId: string, input: AddContactDto, corId: string, ip?: string) {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(emergencyContacts)
      .where(eq(emergencyContacts.userId, userId));
    if (n >= MAX_CONTACTS) {
      throw new ApiError({
        code: 'CONFLICT',
        message: `You can only have ${MAX_CONTACTS} emergency contacts`,
      });
    }
    const id = newId();
    const [row] = await this.db
      .insert(emergencyContacts)
      .values({
        id,
        userId,
        name: input.name,
        phone: input.phone,
        relationship: input.relationship,
        priority: Number(n) + 1,
      })
      .returning();
    this.audit.write({
      actorId: userId,
      action: 'emergency_contact.added',
      targetType: 'emergency_contact',
      targetId: id,
      correlationId: corId,
      ip,
      after: { name: input.name, phone: input.phone },
    });
    return row;
  }

  async removeContact(userId: string, id: string, corId: string, ip?: string) {
    const [row] = await this.db
      .select()
      .from(emergencyContacts)
      .where(and(eq(emergencyContacts.id, id), eq(emergencyContacts.userId, userId)))
      .limit(1);
    if (!row) throw new ApiError({ code: 'NOT_FOUND', message: 'Contact not found' });
    await this.db.delete(emergencyContacts).where(eq(emergencyContacts.id, id));
    this.audit.write({
      actorId: userId,
      action: 'emergency_contact.removed',
      targetType: 'emergency_contact',
      targetId: id,
      correlationId: corId,
      ip,
      before: { name: row.name, phone: row.phone },
    });
    return { removed: true };
  }
}
