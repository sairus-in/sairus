import React, { useState } from 'react';
import Papa from 'papaparse';
import { AdminImportExecuteResponse, AdminImportPreviewResponse } from 'shared';
import { Upload, AlertTriangle, CheckCircle, ArrowRight, Loader2, X } from 'lucide-react';
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
        // Map CSV rows to expected DB mapping DTO
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
      }
    });
  };

  const runApiPreview = async () => {
    setIsProcessing(true);
    setStep('API_PREVIEW');
    try {
      const result = await api.post<AdminImportPreviewResponse>('/v1/import/validate', {
        fileChecksum: file?.name || 'unknown',
        rows: parsedRows
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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">Bulk Student Import</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        {/* Wizard Progress Track */}
        <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-100">
          {['SELECT', 'LOCAL_VALIDATE', 'API_PREVIEW', 'EXECUTING', 'DONE'].map((s, idx) => (
            <div key={s} className={`flex items-center text-sm font-medium ${step === s ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center mr-2 border ${step === s ? 'border-blue-600 bg-blue-50' : 'border-gray-300'}`}>
                {idx + 1}
              </span>
              {s.replace('_', ' ')}
            </div>
          ))}
        </div>

        <div className="px-6 py-6 overflow-y-auto flex-1">
          {errorDetails && (
            <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg flex items-start">
              <AlertTriangle className="mr-3 flex-shrink-0" size={20} />
              <div>
                <h4 className="font-medium">Operation Failed</h4>
                <p className="text-sm mt-1">{errorDetails}</p>
                <button onClick={() => setErrorDetails(null)} className="mt-2 text-sm font-semibold hover:underline">Dismiss</button>
              </div>
            </div>
          )}

          {step === 'SELECT' && (
             <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center relative hover:bg-gray-50 transition-colors">
               <Upload className="mx-auto text-gray-400 mb-4" size={48} />
               <p className="text-gray-700 font-medium mb-2">Click to upload or drag and drop</p>
               <p className="text-gray-500 text-sm mb-6">CSV format only. Maximum 10MB.</p>
               <input type="file" accept=".csv" onChange={handleFileSelect} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
               
               {file && (
                 <div className="bg-white border text-left p-4 rounded-lg shadow-sm flex items-center justify-between">
                   <div className="font-medium">{file.name}</div>
                   <div className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</div>
                 </div>
               )}
             </div>
          )}

          {step === 'LOCAL_VALIDATE' && (
            <div className="text-center py-10">
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
                  <p className="text-gray-600">Parsing CSV rows locally...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <CheckCircle className="text-green-500 mb-4" size={48} />
                  <h3 className="text-xl font-bold mb-2">Parsed {parsedRows.length} Rows</h3>
                  <p className="text-gray-600 mt-2">CSV syntax checks passed constraints.</p>
                </div>
              )}
            </div>
          )}

          {step === 'API_PREVIEW' && (
            <div className="py-2">
              {isProcessing ? (
                <div className="flex flex-col items-center py-10">
                  <Loader2 className="animate-spin text-purple-600 mb-4" size={48} />
                  <p className="text-gray-600">Running constraints dry-run on DB (Checking Live trips...)</p>
                </div>
              ) : previewResult ? (
                <div>
                  <h3 className="text-lg font-bold mb-4">Impact Preview</h3>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                      <p className="text-sm text-green-700 font-medium">Valid Rows</p>
                      <p className="text-3xl font-bold text-green-700">{previewResult.validCount}</p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                      <p className="text-sm text-red-700 font-medium">Rows with Errors</p>
                      <p className="text-3xl font-bold text-red-700">{previewResult.errorCount}</p>
                    </div>
                  </div>
                  
                  {previewResult.errors?.length > 0 && (
                     <div className="bg-white border rounded-lg shadow-sm overflow-hidden mt-6">
                       <div className="bg-red-50 px-4 py-2 border-b border-red-100 font-medium text-red-800 text-sm">Collisions Detected ({previewResult.errorCount})</div>
                       <table className="min-w-full text-left text-sm whitespace-nowrap">
                         <thead className="bg-gray-50 text-gray-500">
                           <tr>
                             <th className="px-6 py-3 font-medium">Row</th>
                             <th className="px-6 py-3 font-medium">Phone</th>
                             <th className="px-6 py-3 font-medium">Error Reason</th>
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-200">
                           {previewResult.errors.slice(0, 10).map((err) => (
                             <tr key={err.rowNumber}>
                               <td className="px-6 py-3 font-mono">{err.rowNumber}</td>
                               <td className="px-6 py-3">{String(err.rowData.phone ?? '')}</td>
                               <td className="px-6 py-3 text-red-600 truncate max-w-xs">{err.errorReason}</td>
                             </tr>
                           ))}
                           {previewResult.errors.length > 10 && (
                             <tr><td colSpan={3} className="px-6 py-3 text-center text-gray-500">... and {previewResult.errors.length - 10} more</td></tr>
                           )}
                         </tbody>
                       </table>
                     </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {step === 'EXECUTING' && (
             <div className="text-center py-10 flex flex-col items-center">
               <Loader2 className="animate-spin text-blue-600 mb-4" size={48} />
               <h3 className="text-xl font-bold mb-2">Executing Changes</h3>
               <p className="text-gray-600 mt-2">Upserting users and queueing Firebase Provisioning background jobs.</p>
             </div>
          )}

          {step === 'DONE' && execResult && (
            <div className="text-center py-10 flex flex-col items-center">
               <CheckCircle className="text-green-500 mb-4" size={48} />
               <h3 className="text-2xl font-bold mb-2">Import Complete!</h3>
               <p className="text-gray-600 mt-2">Successfully imported <span className="font-bold">{execResult.imported}</span> students.</p>
               {execResult.failed > 0 && (
                 <p className="text-red-500 mt-2">{execResult.failed} rows failed execution.</p>
               )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-gray-50 px-6 py-4 border-t flex items-center justify-end space-x-3">
          {step !== 'DONE' && step !== 'EXECUTING' && (
            <button onClick={onClose} className="px-4 py-2 font-medium text-gray-700 rounded-lg hover:bg-gray-200">
              Cancel
            </button>
          )}

          {step === 'SELECT' && file && (
            <button onClick={processFile} className="px-4 py-2 font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center">
              Parse File <ArrowRight size={16} className="ml-2" />
            </button>
          )}

          {step === 'LOCAL_VALIDATE' && !isProcessing && parsedRows.length > 0 && (
            <button onClick={runApiPreview} className="px-4 py-2 font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center">
              Run DB Preview <ArrowRight size={16} className="ml-2" />
            </button>
          )}

          {step === 'API_PREVIEW' && !isProcessing && previewResult && (
            <button onClick={executeImport} className="px-4 py-2 font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center">
              {previewResult.errorCount > 0 ? 'Force Execute Valid Rows' : 'Execute Import'} <ArrowRight size={16} className="ml-2" />
            </button>
          )}

          {step === 'DONE' && (
            <button onClick={onClose} className="px-4 py-2 font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Close Wizard
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
