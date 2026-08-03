"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  commitImportAction,
  previewImportAction,
  type CommitState,
  type PreviewState,
} from "../../actions";
import { ACCOUNT_FIELDS } from "@/lib/services/growth/csv";

/**
 * Staged import: the file is read client-side and the TEXT travels with
 * each step (preview, re-preview after mapping changes, commit) — the
 * server stays stateless about content and never stores the raw file.
 * Nothing is written until the user confirms the commit step.
 */

export function ImportWizard({
  activeProfiles,
}: {
  activeProfiles: { id: string; name: string }[];
}) {
  const [targetProfileId, setTargetProfileId] = useState(activeProfiles[0]?.id ?? "");
  const [fileText, setFileText] = useState<string | null>(null);
  const [filename, setFilename] = useState("import.csv");
  const [mappingDraft, setMappingDraft] = useState<Record<string, string> | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [acceptPartial, setAcceptPartial] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [previewState, previewAction, previewPending] = useActionState<
    PreviewState,
    FormData
  >(previewImportAction, null);
  const [commitState, commitAction, commitPending] = useActionState<
    CommitState,
    FormData
  >(commitImportAction, null);

  const preview = previewState?.ok ? previewState.preview : null;
  const mapping = mappingDraft ?? preview?.mapping ?? null;

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("File exceeds the 2 MB limit");
      event.target.value = "";
      return;
    }
    setFilename(file.name.replace(/[/\\]/g, "_"));
    setFileText(await file.text());
    setMappingDraft(null);
    setResolutions({});
    setAcceptPartial(false);
  }

  if (commitState?.ok) {
    return (
      <div className="max-w-xl space-y-3 rounded-lg border border-border bg-card p-5 text-sm">
        <h2 className="text-base font-semibold">Import committed</h2>
        <p>
          {commitState.accepted} account{commitState.accepted === 1 ? "" : "s"} created ·{" "}
          {commitState.linked} linked to existing accounts · {commitState.skipped} skipped ·{" "}
          {commitState.rejected} invalid rows not imported.
        </p>
        <Link href="/growth/accounts" className="text-primary hover:underline">
          Go to accounts →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">1 · Target profile and file</h2>
        {activeProfiles.length === 0 ? (
          <p className="mb-2 text-sm text-danger">
            Imports require an ACTIVE target profile. Create and activate one
            first.
          </p>
        ) : (
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium" htmlFor="import-profile">
              Target profile (bound at preview; commit uses the same profile)
            </label>
            <select
              id="import-profile"
              value={targetProfileId}
              onChange={(event) => setTargetProfileId(event.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {activeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={onFileChange}
          className="text-sm"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          UTF-8 CSV, comma or semicolon separated, up to 2 MB / 2000 rows.
          Nothing is imported until you confirm the final step.
        </p>
      </section>

      {fileText ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">2 · Preview and map columns</h2>
          <form action={previewAction} className="space-y-2">
            <input type="hidden" name="filename" value={filename} />
            <input type="hidden" name="text" value={fileText} />
            <input type="hidden" name="mapping" value={mapping ? JSON.stringify(mapping) : ""} />
            <input type="hidden" name="targetProfileId" value={targetProfileId} />
            <Button type="submit" variant="outline" size="sm" disabled={previewPending || !targetProfileId}>
              {previewPending ? "Analysing…" : preview ? "Re-run preview" : "Preview file"}
            </Button>
            {previewState && !previewState.ok ? (
              <p role="alert" className="text-sm text-red-600">
                {previewState.error}
              </p>
            ) : null}
          </form>

          {preview ? (
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Rows" value={preview.rowCount} />
                <Stat label="Ready" value={preview.validRows.length} />
                <Stat label="Invalid" value={preview.invalidRows.length} />
                <Stat label="Duplicates" value={preview.duplicates.length} />
              </div>

              <div>
                <h3 className="mb-1 font-medium">Column mapping</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {preview.headers.map((header) => (
                    <label key={header} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-mono">{header}</span>
                      <select
                        value={mapping?.[header] ?? "ignore"}
                        aria-label={`Mapping for ${header}`}
                        onChange={(event) =>
                          setMappingDraft({
                            ...(mapping ?? {}),
                            [header]: event.target.value,
                          })
                        }
                        className="h-8 rounded-md border border-border bg-background px-1.5"
                      >
                        <option value="ignore">— ignore —</option>
                        {ACCOUNT_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {mappingDraft ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Mapping changed — re-run the preview to refresh validation.
                  </p>
                ) : null}
              </div>

              {preview.invalidRows.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-medium text-danger">
                    Invalid rows ({preview.invalidRows.length})
                  </h3>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                    {preview.invalidRows.map((row) => (
                      <li key={row.rowNumber}>
                        Row {row.rowNumber}: {row.errors.join(", ")}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={acceptPartial}
                      onChange={(event) => setAcceptPartial(event.target.checked)}
                    />
                    Import the valid rows anyway (invalid rows are skipped)
                  </label>
                </div>
              ) : null}

              {preview.duplicates.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-medium">Duplicates ({preview.duplicates.length})</h3>
                  <div className="space-y-2">
                    {preview.duplicates.map((duplicate) => (
                      <div
                        key={`${duplicate.rowNumber}-${duplicate.reason}`}
                        className="rounded-md border border-border p-2 text-xs"
                      >
                        <p>
                          Row {duplicate.rowNumber} —{" "}
                          <strong>{duplicate.kind === "exact" ? "exact duplicate" : duplicate.kind === "in_file" ? "duplicate inside file" : "possible duplicate"}</strong>{" "}
                          ({duplicate.reason.replace(/_/g, " ")})
                          {duplicate.existingAccountName ? ` of “${duplicate.existingAccountName}”` : ""}
                        </p>
                        <div className="mt-1 flex gap-3">
                          {(["skip", "new", "link"] as const).map((option) => {
                            const disabled =
                              (option === "new" && duplicate.reason === "domain_exact") ||
                              (option === "link" && !duplicate.existingAccountId);
                            const value =
                              option === "link"
                                ? `link:${duplicate.existingAccountId}`
                                : option;
                            return (
                              <label key={option} className={disabled ? "opacity-40" : ""}>
                                <input
                                  type="radio"
                                  name={`resolution-${duplicate.rowNumber}`}
                                  disabled={disabled}
                                  checked={(resolutions[duplicate.rowNumber] ?? "skip") === value}
                                  onChange={() =>
                                    setResolutions({
                                      ...resolutions,
                                      [duplicate.rowNumber]: value,
                                    })
                                  }
                                />{" "}
                                {option === "skip"
                                  ? "Skip"
                                  : option === "new"
                                    ? "Import as new"
                                    : "Link to existing"}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {preview.suppressedRows.length > 0 ? (
                <div>
                  <h3 className="mb-1 font-medium text-danger">
                    Suppressed ({preview.suppressedRows.length})
                  </h3>
                  <ul className="text-xs text-muted-foreground">
                    {preview.suppressedRows.map((row) => (
                      <li key={row.rowNumber}>
                        Row {row.rowNumber}:{" "}
                        {[
                          row.domainCode
                            ? "domain suppressed — account imports directly as suppressed"
                            : null,
                          row.contactCode === "contact_erased_tombstone"
                            ? "contact was erased — the person will NOT be recreated"
                            : row.contactCode === "contact_suppressed"
                              ? "contact suppressed — imported pre-marked, never sendable"
                              : null,
                        ]
                          .filter(Boolean)
                          .join("; ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {preview && !mappingDraft ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">3 · Confirm import</h2>
          <form action={commitAction} className="space-y-2">
            <input type="hidden" name="importId" value={preview.importId} />
            <input type="hidden" name="filename" value={filename} />
            <input type="hidden" name="text" value={fileText ?? ""} />
            <input type="hidden" name="mapping" value={JSON.stringify(preview.mapping)} />
            <input type="hidden" name="resolutions" value={JSON.stringify(resolutions)} />
            <input type="hidden" name="acceptPartial" value={acceptPartial ? "true" : "false"} />
            <p className="text-xs text-muted-foreground">
              Profile: {preview.targetProfileName}. {preview.validRows.length} rows import as new accounts;{" "}
              {preview.duplicates.length} duplicates follow your resolutions
              (default skip); invalid rows are never imported.
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={
                commitPending ||
                (preview.invalidRows.length > 0 && !acceptPartial)
              }
            >
              {commitPending ? "Importing…" : "Commit import"}
            </Button>
            {commitState && !commitState.ok ? (
              <p role="alert" className="text-sm text-red-600">
                {commitState.error}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
