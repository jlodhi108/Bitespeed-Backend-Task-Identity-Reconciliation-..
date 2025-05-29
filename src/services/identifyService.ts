import { PrismaClient, Contact } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Consolidated contact response type
 */
export interface ConsolidatedContact {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

/**
 * Main reconciliation routine
 */
export async function identify(
  email: string | null,
  phoneNumber: string | null
): Promise<ConsolidatedContact> {
  // 1. fetch any contacts that match either identifier
  const matches = await prisma.contact.findMany({
    where: {
      OR: [
        email ? { email } : undefined,
        phoneNumber ? { phoneNumber } : undefined,
      ].filter(Boolean) as any,
      deletedAt: null,
    },
  });

  // When nothing matches ⇒ create brand-new primary
  if (matches.length === 0) {
    const created = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary",
      },
    });
    return toPayload(created.id, [created]);
  }

  // 2. find distinct primary IDs among matches
  const primaryIds = new Set<number>();
  for (const c of matches) {
    primaryIds.add(c.linkPrecedence === "primary" ? c.id : (c.linkedId as number));
  }

  let primaryId: number;

  // 3. merge logic
  if (primaryIds.size === 1) {
    // One identity cluster
    primaryId = [...primaryIds][0];
  } else {
    // Two primaries → pick oldest
    //   fetch both primaries
    const primaries = await prisma.contact.findMany({
      where: { id: { in: [...primaryIds] } },
    });

    primaries.sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime()
    );
    const oldest = primaries[0];
    const newer = primaries[1];
    primaryId = oldest.id;

    // demote newer to secondary + relink its children
    await prisma.$transaction([
      prisma.contact.update({
        where: { id: newer.id },
        data: {
          linkPrecedence: "secondary",
          linkedId: oldest.id,
        },
      }),
      prisma.contact.updateMany({
        where: { linkedId: newer.id },
        data: { linkedId: oldest.id },
      }),
    ]);
  }

  // 4. ensure we have a contact row with the *exact* (email, phone) combo
  const alreadyExists = await prisma.contact.findFirst({
    where: {
      linkedId: primaryId,
      email,
      phoneNumber,
    },
  });
  if (!alreadyExists) {
    // also check if identical combo is on the primary itself
    const primary = await prisma.contact.findUnique({ where: { id: primaryId } });
    if (!(primary?.email === email && primary?.phoneNumber === phoneNumber)) {
      await prisma.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "secondary",
          linkedId: primaryId,
        },
      });
    }
  }

  // 5. fetch the full cluster
  const cluster = await prisma.contact.findMany({
    where: {
      OR: [{ id: primaryId }, { linkedId: primaryId }],
      deletedAt: null,
    },
  });

  return toPayload(primaryId, cluster);
}

/**
 * Build response payload from cluster
 */
function toPayload(primaryId: number, cluster: Contact[]): ConsolidatedContact {
  const primary = cluster.find((c) => c.id === primaryId)!;

  const emails = unique(
    [primary.email, ...cluster.map((c) => c.email)].filter(Boolean) as string[]
  );
  const phones = unique(
    [primary.phoneNumber, ...cluster.map((c) => c.phoneNumber)].filter(Boolean) as string[]
  );

  const secondaryIds = cluster
    .filter((c) => c.linkPrecedence === "secondary")
    .map((c) => c.id);

  return {
    primaryContactId: primaryId,
    emails,
    phoneNumbers: phones,
    secondaryContactIds: secondaryIds,
  };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
