import { parsePublishedPackage } from './domain/package';

export async function loadDemoPackage() {
  const { default: data } = await import('./fixtures/demo-package.json');
  return parsePublishedPackage(data);
}
