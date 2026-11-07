// Help-ticket categories (B3.2, B3.3-R5): general categories go to on-duty volunteers in the
// ticket's zone; one partner category per configured partner goes to that partner's staff.
// Category IDs come from here, never from parsing free text. Medical or safety issues are not a
// category: the app shows `config.help` instead.

export type TicketCategory = { id: string; name: string; partner: string | null };

export const GENERAL_TICKET_CATEGORIES: readonly TicketCategory[] = [
  { id: "wifi", name: "Wi-Fi", partner: null },
  { id: "power", name: "Power", partner: null },
  { id: "hardware", name: "Hardware", partner: null },
  { id: "furniture", name: "Furniture", partner: null },
  { id: "food", name: "Food", partner: null },
  { id: "lost-item", name: "Lost item", partner: null },
  { id: "other", name: "Other", partner: null },
];

const PARTNER_PREFIX = "partner:";

export function ticketCategories(config: {
  partners: readonly { id: string; name: string }[];
}): TicketCategory[] {
  return [
    ...GENERAL_TICKET_CATEGORIES,
    ...config.partners.map((p) => ({
      id: `${PARTNER_PREFIX}${p.id}`,
      name: `${p.name} help`,
      partner: p.id,
    })),
  ];
}

/** The category with this ID under this config, or undefined when it is not one. */
export const ticketCategory = (
  config: { partners: readonly { id: string; name: string }[] },
  id: string,
): TicketCategory | undefined => ticketCategories(config).find((c) => c.id === id);
