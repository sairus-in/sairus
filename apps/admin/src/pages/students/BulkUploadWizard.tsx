import React, { useState } from 'react';
import Papa from 'papaparse';
import { AdminImportExecuteResponse, AdminImportPreviewResponse } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

export type WizardStep = 'SELECT' | 'LOCAL_VALIDATE' | 'API_PREVIEW' | 'EXECUTING' | 'DONE';
type CsvStudentRow = Record<string, string | undefined>;
type ParsedStudentImportRow = {
  phone?: string;
  name?: string;
  rollNumber?: string;
  email?: string;
  department?: string;
  year?: number;
  assignedRouteId?: string;
  assignedStopId?: string;
};

const stepLabels: WizardStep[] = ['SELECT', 'LOCAL_VALIDATE', 'API_PREVIEW', 'EXECUTING', 'DONE'];

export const BulkUploadWizard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step, setStep] = useState<WizardStep>('SELECT');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedStudentImportRow[]>([]);
  const [previewResult, setPreviewResult] = useState<AdminImportPreviewResponse | null>(null);
  const [execResult, setExecResult] = useState<AdminImportExecuteResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const processFile = () => {
    if (!file) return;
    setStep('LOCAL_VALIDATE');
    setIsProcessing(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const formatted = results.data.map((row) => {
          const csvRow = row as CsvStudentRow;
          return {
            phone: csvRow.phone?.trim(),
            name: csvRow.name?.trim(),
            rollNumber: csvRow.rollNumber?.trim(),
            email: csvRow.email?.trim() || undefined,
            department: csvRow.department?.trim() || undefined,
            year: csvRow.year ? parseInt(csvRow.year, 10) : undefined,
            assignedRouteId: csvRow.assignedRouteId?.trim() || undefined,
            assignedStopId: csvRow.assignedStopId?.trim() || undefined,
          };
        });
        setParsedRows(formatted);
        setIsProcessing(false);
      },
      error: (error) => {
        setErrorDetails(error.message);
        setIsProcessing(false);
      },
    });
  };

  const runApiPreview = async () => {
    setIsProcessing(true);
    setStep('API_PREVIEW');
    try {
      const result = await api.post<AdminImportPreviewResponse>('/v1/import/validate', {
        fileChecksum: file?.name || 'unknown',
        rows: parsedRows,
      });
      setPreviewResult(result);
    } catch (error) {
      setErrorDetails(extractApiError(error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const executeImport = async () => {
    if (!previewResult?.sessionId) return;
    setIsProcessing(true);
    setStep('EXECUTING');
    try {
      const result = await api.post<AdminImportExecuteResponse>(`/v1/import/${previewResult.sessionId}/execute`);
      setExecResult(result);
      setStep('DONE');
    } catch (error) {
      setErrorDetails(extractApiError(error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(18,18,20,0.38)', backdropFilter: 'blur(4px)' }}>
      <div style={{ width: 'min(880px, 96vw)', maxHeight: '90vh', overflow: 'hidden', borderRadius: 24, border: '1px solid var(--border-2)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--divider)' }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bulk Import</div>
            <h2 style={{ margin: '8px 0 0', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500 }}>Student CSV Import</h2>
          </div>
          <button type="button" onClick={onClose} style={{ width: 36, height: 36, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderBottom: '1px solid var(--divider)', background: 'var(--surface-2)' }}>
          {stepLabels.map((label, index) => {
            const active = label === step;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, color: active ? 'var(--ink)' : 'var(--muted)' }}>
                <span style={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`, background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--accent-ink)' : 'inherit', fontSize: 11 }}>
                  {index + 1}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{label.replace('_', ' ')}</span>
              </div>
            );
          })}
        </div>

        <div className="scroll" style={{ padding: 20, maxHeight: 'calc(90vh - 148px)', display: 'grid', gap: 16 }}>
          {errorDetails ? (
            <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
              {errorDetails}
            </div>
          ) : null}

          {step === 'SELECT' ? (
            <label
              style={{
                display: 'grid',
                placeItems: 'center',
                gap: 10,
                minHeight: 260,
                borderRadius: 24,
                border: '1px dashed var(--border-2)',
                background: 'var(--surface-2)',
                textAlign: 'center',
                cursor: 'pointer',
                padding: 24,
              }}
            >
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Upload CSV</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500 }}>Click to upload or drag a CSV file</div>
              <div style={{ color: 'var(--muted)' }}>Maximum 10MB. Expected columns should match the current import contract.</div>
              {file ? (
                <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </div>
              ) : null}
              <input type="file" accept=".csv" onChange={handleFileSelect} style={{ display: 'none' }} />
            </label>
          ) : null}

          {step === 'LOCAL_VALIDATE' ? (
            <div style={{ display: 'grid', gap: 10, placeItems: 'center', minHeight: 220 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500 }}>{isProcessing ? 'Parsing CSV…' : `Parsed ${parsedRows.length} Rows`}</div>
              <div style={{ color: 'var(--muted)' }}>{isProcessing ? 'Normalizing CSV rows against the expected DTO.' : 'Local CSV syntax checks completed.'}</div>
            </div>
          ) : null}

          {step === 'API_PREVIEW' ? (
            isProcessing ? (
              <div style={{ display: 'grid', gap: 10, placeItems: 'center', minHeight: 220 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500 }}>Running DB Preview…</div>
                <div style={{ color: 'var(--muted)' }}>Checking collisions and route assignment issues against live backend state.</div>
              </div>
            ) : previewResult ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ padding: 16, borderRadius: 18, background: 'var(--ok-soft)', border: '1px solid var(--ok)' }}>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Valid Rows</div>
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 500 }}>{previewResult.validCount}</div>
                  </div>
                  <div style={{ padding: 16, borderRadius: 18, background: 'var(--err-soft)', border: '1px solid var(--err)' }}>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Rows With Errors</div>
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 500 }}>{previewResult.errorCount}</div>
                  </div>
                </div>

                {previewResult.errors?.length ? (
                  <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 280 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                        <tr>
                          {['Row', 'Phone', 'Error Reason'].map((label) => (
                            <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewResult.errors.slice(0, 12).map((err) => (
                          <tr key={err.rowNumber}>
                            <td className="mono" style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{err.rowNumber}</td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)' }}>{String(err.rowData.phone ?? '')}</td>
                            <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--divider)', color: 'var(--err)' }}>{err.errorReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null
          ) : null}

          {step === 'EXECUTING' ? (
            <div style={{ display: 'grid', gap: 10, placeItems: 'center', minHeight: 220 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500 }}>Executing Import…</div>
              <div style={{ color: 'var(--muted)' }}>Upserting users and triggering downstream provisioning jobs.</div>
            </div>
          ) : null}

          {step === 'DONE' && execResult ? (
            <div style={{ display: 'grid', gap: 10, placeItems: 'center', minHeight: 220 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 500 }}>Import Complete</div>
              <div style={{ color: 'var(--muted)' }}>Imported {execResult.imported} students.</div>
              {execResult.failed > 0 ? <div style={{ color: 'var(--err)' }}>{execResult.failed} rows failed execution.</div> : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: '1px solid var(--divider)', background: 'var(--surface-2)' }}>
          {step !== 'DONE' && step !== 'EXECUTING' ? (
            <button type="button" onClick={onClose} style={{ borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 16px' }}>
              Cancel
            </button>
          ) : null}
          {step === 'SELECT' && file ? (
            <button type="button" onClick={processFile} style={{ borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontWeight: 500 }}>
              Parse File
            </button>
          ) : null}
          {step === 'LOCAL_VALIDATE' && !isProcessing && parsedRows.length > 0 ? (
            <button type="button" onClick={runApiPreview} style={{ borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontWeight: 500 }}>
              Run DB Preview
            </button>
          ) : null}
          {step === 'API_PREVIEW' && !isProcessing && previewResult ? (
            <button type="button" onClick={executeImport} style={{ borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontWeight: 500 }}>
              {previewResult.errorCount > 0 ? 'Force Execute Valid Rows' : 'Execute Import'}
            </button>
          ) : null}
          {step === 'DONE' ? (
            <button type="button" onClick={onClose} style={{ borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontWeight: 500 }}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
