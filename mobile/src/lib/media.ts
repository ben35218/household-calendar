import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

// A file ready to append to a multipart FormData (React Native shape).
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

function inferName(uri: string, fallback: string): string {
  const last = uri.split('/').pop();
  return last && last.includes('.') ? last : fallback;
}

// Take a photo with the camera. Returns null if permission is denied or the
// user cancels. Used by the "scan" flows (item / receipt / recipe / confirmation
// photo) that POST to the existing from-photo endpoints.
export async function takePhoto(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? inferName(asset.uri, 'photo.jpg'),
    type: asset.mimeType ?? 'image/jpeg',
  };
}

export async function pickImage(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? inferName(asset.uri, 'photo.jpg'),
    type: asset.mimeType ?? 'image/jpeg',
  };
}

// Pick a document (PDF, image, or .eml) for manual/attachment/confirmation
// uploads. Mirrors the web app's file inputs.
export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*', 'message/rfc822'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name ?? inferName(asset.uri, 'document'),
    type: asset.mimeType ?? 'application/octet-stream',
  };
}
