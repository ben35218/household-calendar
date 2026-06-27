import api from '../api/client';
import type { PickedFile } from './media';

// Upload a picked file as multipart/form-data to any endpoint that expects a
// single file field (e.g. items/from-photo → field 'photo',
// inventory/from-receipt-photo → 'photo', manuals upload → 'file'). The bearer
// token is attached by the shared request interceptor.
export async function uploadFile<T = unknown>(
  path: string,
  file: PickedFile,
  fieldName = 'photo'
): Promise<T> {
  const form = new FormData();
  // RN FormData accepts this {uri,name,type} shape for file parts.
  form.append(fieldName, { uri: file.uri, name: file.name, type: file.type } as any);
  const { data } = await api.post<T>(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
