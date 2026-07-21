import api from '../api/client';
import type { PickedFile } from './media';

// Upload a picked file as multipart/form-data to any endpoint that expects a
// single file field (e.g. items/from-photo → field 'photo', manuals upload →
// 'file'). The bearer token is attached by the shared request interceptor.
export async function uploadFile<T = unknown>(
  path: string,
  file: PickedFile,
  fieldName = 'photo',
  extraFields?: Record<string, string | number | boolean>
): Promise<T> {
  const form = new FormData();
  // RN FormData accepts this {uri,name,type} shape for file parts.
  form.append(fieldName, { uri: file.uri, name: file.name, type: file.type } as any);
  // Extra text fields (e.g. E2EE attachment upload: encrypted, _id,
  // wrappedFileKey, keyVersion, fileType, title).
  for (const [k, v] of Object.entries(extraFields || {})) form.append(k, String(v));
  const { data } = await api.post<T>(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
