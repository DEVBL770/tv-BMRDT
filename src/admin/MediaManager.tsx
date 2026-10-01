import { useEffect, useState, type ChangeEvent } from 'react';
import { supabase } from '../lib/supabase';
import { adminErrorMessage, invokeAdmin } from './adminApi';
import { normalizeImageFile, renderPdfPages } from './mediaPipeline';
import type { MediaAsset } from './AdminConsole';

type UploadTicket = {
  mediaId: string;
  path: string;
  token: string;
};

type Progress = {
  fileName: string;
  completed: number;
  total: number;
  phase: string;
};

export function MediaManager({
  isDemo,
  media,
  budgetMb,
  onRefresh,
  onToast,
}: {
  isDemo: boolean;
  media: MediaAsset[];
  budgetMb: number;
  onRefresh: () => Promise<void>;
  onToast: (value: string) => void;
}) {
  const [progress, setProgress] = useState<Progress>();
  const [working, setWorking] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const pdfPageCounts = new Map<string, number>();
  for (const asset of media) {
    if (asset.kind === 'pdf_page' && asset.parent_id) {
      pdfPageCounts.set(asset.parent_id, (pdfPageCounts.get(asset.parent_id) ?? 0) + 1);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadUrls() {
      const client = supabase;
      if (!client) return;
      const images = media.filter(
        (item) => item.status === 'ready' && item.mime.startsWith('image/'),
      );
      const entries = await Promise.all(
        images.map(async (item) => {
          const { data } = await client.storage
            .from('media')
            .createSignedUrl(item.storage_path, 300);
          return data?.signedUrl ? ([item.id, data.signedUrl] as const) : null;
        }),
      );
      if (active) setMediaUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    }
    void loadUrls();
    return () => {
      active = false;
    };
  }, [media]);

  async function uploadBlob(
    blob: Blob,
    mime: string,
    kind: 'image' | 'pdf' | 'pdf_page',
    originalName: string,
    parentId?: string,
    pageIndex?: number,
  ): Promise<string> {
    if (!supabase) throw new Error('database_unavailable');
    const ticket = await invokeAdmin<UploadTicket>(supabase, 'createUpload', {
      kind,
      mime,
      bytes: blob.size,
      originalName,
      ...(parentId ? { parentId } : {}),
      ...(pageIndex ? { pageIndex } : {}),
    });
    const { error } = await supabase.storage
      .from('media')
      .uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: mime, upsert: false });
    if (error) throw new Error('upload_unavailable');
    const finalized = await invokeAdmin<{ status: string; error?: string }>(
      supabase,
      'finalizeUpload',
      { mediaId: ticket.mediaId },
    );
    if (finalized.status !== 'ready') throw new Error(finalized.error ?? 'invalid_media');
    return ticket.mediaId;
  }

  async function uploadFiles(files: File[]) {
    if (!files.length || isDemo || !supabase || working) return;
    setWorking(true);
    setProgress(undefined);
    let completedAssets = 0;
    try {
      for (const file of files) {
        if (file.type === 'application/pdf') {
          setProgress({ fileName: file.name, completed: 0, total: 1, phase: 'Lecture du PDF…' });
          const pages = await renderPdfPages(file);
          const total = pages.length + 1;
          setProgress({
            fileName: file.name,
            completed: 0,
            total,
            phase: 'Envoi du PDF original…',
          });
          const parentId = await uploadBlob(file, 'application/pdf', 'pdf', file.name);
          completedAssets += 1;
          setProgress({ fileName: file.name, completed: 1, total, phase: 'PDF original vérifié.' });
          for (let index = 0; index < pages.length; index += 1) {
            const page = pages[index];
            const mime = page.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
            const name = `${file.name} · page ${index + 1}.${mime === 'image/webp' ? 'webp' : 'jpg'}`;
            setProgress({
              fileName: file.name,
              completed: index + 1,
              total,
              phase: `Envoi de la page ${index + 1}/${pages.length}…`,
            });
            await uploadBlob(page, mime, 'pdf_page', name, parentId, index + 1);
            completedAssets += 1;
          }
          setProgress({
            fileName: file.name,
            completed: total,
            total,
            phase: 'PDF et pages prêts.',
          });
        } else if (file.type.startsWith('image/')) {
          setProgress({
            fileName: file.name,
            completed: 0,
            total: 1,
            phase: 'Correction de l’orientation et conversion…',
          });
          const normalized = await normalizeImageFile(file);
          setProgress({
            fileName: file.name,
            completed: 0,
            total: 1,
            phase: 'Envoi de l’image normalisée…',
          });
          await uploadBlob(normalized.blob, normalized.mime, 'image', file.name);
          completedAssets += 1;
          setProgress({ fileName: file.name, completed: 1, total: 1, phase: 'Image prête.' });
        } else {
          throw new Error('invalid_media');
        }
      }
      await onRefresh();
      onToast(`${completedAssets} fichier(s) média téléversé(s) et vérifié(s).`);
    } catch (error) {
      onToast(adminErrorMessage(error));
      await onRefresh();
    } finally {
      setWorking(false);
      window.setTimeout(() => setProgress(undefined), 3000);
    }
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void uploadFiles(files);
  }

  async function deleteAsset(asset: MediaAsset) {
    if (!supabase || !window.confirm(`Supprimer « ${asset.original_name_label} » ?`)) return;
    try {
      await invokeAdmin(supabase, 'deleteMedia', { id: asset.id });
      await onRefresh();
      onToast('Média supprimé.');
    } catch (error) {
      onToast(adminErrorMessage(error));
    }
  }

  const usedBytes = media
    .filter((asset) => asset.status === 'ready')
    .reduce((total, asset) => total + asset.bytes, 0);
  const usedMb = usedBytes / 1_000_000;
  const budgetPercent = Math.min(100, (usedMb / Math.max(budgetMb, 1)) * 100);

  return (
    <section className="admin-page">
      <article className="admin-card">
        <h2>Importer des médias</h2>
        <p className="form-note">
          Les photos sont orientées selon les données de l’appareil, redimensionnées au besoin et
          réencodées sans métadonnées EXIF/GPS. Les PDF sont limités à six pages et chaque page est
          préparée pour l’écran.
        </p>
        <label className="media-file-picker">
          <span>Choisir des photos ou des PDF</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={isDemo || working}
            onChange={onFilesSelected}
          />
        </label>
        {isDemo ? (
          <p className="form-note">
            Le téléversement nécessite Supabase. Les médias existants restent consultables en
            démonstration.
          </p>
        ) : null}
        {progress ? (
          <div className="upload-progress" role="status" aria-live="polite">
            <div className="progress-heading">
              <strong>{progress.fileName}</strong>
              <span>
                {progress.completed}/{progress.total}
              </span>
            </div>
            <progress max={progress.total} value={progress.completed} />
            <small>{progress.phase}</small>
          </div>
        ) : null}
      </article>
      <article className="admin-card">
        <div className="card-heading-row">
          <div>
            <h2>Espace média</h2>
            <p className="form-note">
              {usedMb.toFixed(1)} Mo utilisés sur {budgetMb} Mo autorisés.
            </p>
          </div>
          <strong>{media.filter((asset) => asset.status === 'ready').length} prêt(s)</strong>
        </div>
        <div className="media-budget">
          <span style={{ width: `${budgetPercent}%` }} />
        </div>
        {budgetPercent >= 90 ? (
          <p className="dirty-note">
            L’espace média approche de sa limite. Supprimez les médias inutilisés avant d’en
            importer d’autres.
          </p>
        ) : null}
        {media.length ? (
          <div className="media-grid">
            {media.map((asset) => (
              <article className="media-card" key={asset.id}>
                {mediaUrls[asset.id] ? (
                  <img src={mediaUrls[asset.id]} alt="" loading="lazy" />
                ) : (
                  <div className="media-placeholder">
                    {asset.kind === 'pdf'
                      ? 'PDF'
                      : asset.kind === 'pdf_page'
                        ? `Page ${asset.page_index ?? ''}`
                        : 'Image'}
                  </div>
                )}
                <div className="media-card-details">
                  <strong>{asset.original_name_label}</strong>
                  <small>
                    {asset.kind} · {asset.mime} · {(asset.bytes / 1_000_000).toFixed(2)} Mo
                  </small>
                  <small>
                    {asset.width && asset.height ? `${asset.width} × ${asset.height} px · ` : ''}
                    {asset.status === 'ready'
                      ? 'Prêt'
                      : asset.status === 'pending'
                        ? 'En attente'
                        : `Refusé · ${asset.error_code ?? 'erreur'}`}
                  </small>
                  {asset.parent_id ? <small>Document parent · {asset.parent_id}</small> : null}
                  {asset.kind === 'pdf' && pdfPageCounts.get(asset.id) ? (
                    <small>{pdfPageCounts.get(asset.id)} page(s)</small>
                  ) : null}
                  <button
                    type="button"
                    disabled={isDemo || asset.status === 'pending'}
                    onClick={() => void deleteAsset(asset)}
                  >
                    Supprimer
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Aucun média importé.</p>
        )}
      </article>
    </section>
  );
}
