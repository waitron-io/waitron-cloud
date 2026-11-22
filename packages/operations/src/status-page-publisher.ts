import { renderStatusPage } from './status-page.ts';

const fields = ['service', 'impact', 'confirmedAt'];

export async function publishInvestigatingUpdate(
  incident: unknown,
  upload: (pages: ReturnType<typeof renderStatusPage>) => Promise<void>,
): Promise<void> {
  if (!incident || typeof incident !== 'object' || Array.isArray(incident)
    || Object.keys(incident).length !== fields.length
    || !fields.every((field) => Object.hasOwn(incident, field))) {
    throw new Error('Invalid public status input');
  }

  const { service, impact, confirmedAt } = incident as Record<string, unknown>;
  const pages = renderStatusPage({ state: 'investigating', service, impact, updatedAt: confirmedAt });
  await upload(pages);
}
