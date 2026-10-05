import { supabase } from '../lib/supabase';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export async function invokeAdmin<T>(
  client: NonNullable<typeof supabase>,
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke('admin', { body: { action, ...input } });
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const payload = record(await error.context.json().catch(() => ({})));
      if (typeof payload.error === 'string') throw new Error(payload.error);
    }
    throw new Error(error.message);
  }
  const payload = record(data);
  if (typeof payload.error === 'string') throw new Error(payload.error);
  return data as T;
}

export function adminErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    version_conflict:
      'Une autre personne a publié entre-temps. Rechargez le brouillon avant de réessayer.',
    calendar_horizon_short:
      'Les données de calendrier sont trop anciennes. Actualisez les sources avant de publier.',
    refresh_in_progress: 'Une actualisation est déjà en cours.',
    media_in_use: 'Ce média est utilisé par une publication et ne peut pas être supprimé.',
    media_too_large: 'Le fichier dépasse la taille maximale autorisée.',
    media_dimensions_too_large: 'Les dimensions de l’image dépassent la limite autorisée.',
    invalid_media: 'Le format ou le contenu du fichier est invalide.',
    media_not_found: 'Le fichier n’a pas été retrouvé après son téléversement.',
    media_unavailable: 'Le service de médias est momentanément indisponible.',
    pdf_page_limit: 'Ce PDF contient plus de six pages. Réduisez-le avant de le déposer.',
    pdf_too_many_pages: 'Ce PDF contient plus de six pages. Réduisez-le avant de le déposer.',
    upload_missing: 'Le fichier téléversé est introuvable. Réessayez.',
    upload_unavailable: 'Le téléversement a échoué. Vérifiez la connexion puis réessayez.',
    finalize_unavailable: 'Le fichier a été envoyé, mais sa vérification a échoué.',
    media_not_ready: 'Un média n’est pas encore prêt. Attendez la fin du traitement.',
    restore_media_missing: 'Un média de cette ancienne version n’est plus disponible.',
    pdf_decode_failed: 'Ce PDF ne peut pas être lu. Vérifiez le fichier puis réessayez.',
    invalid_request: 'Les informations envoyées ne sont pas valides. Vérifiez le formulaire.',
    pairing_unavailable: 'Impossible de créer un code TV pour le moment.',
    device_not_found: 'Cet appareil n’existe plus.',
    publish_unavailable: 'La publication n’a pas abouti. Aucun changement n’a été publié.',
    restore_unavailable: 'La restauration a échoué. La version active n’a pas changé.',
    database_unavailable: 'La base Supabase est momentanément indisponible.',
    image_decode_failed: 'Cette image ne peut pas être lue par le navigateur.',
    image_canvas_unavailable: 'La préparation de l’image n’est pas disponible sur cet appareil.',
    image_encode_failed: 'La conversion de l’image a échoué.',
    pdf_canvas_unavailable: 'Le rendu de la page PDF n’est pas disponible.',
    pdf_encode_failed: 'La conversion d’une page PDF a échoué.',
  };
  return messages[code] ?? 'Une erreur est survenue. Vérifiez votre connexion et réessayez.';
}
