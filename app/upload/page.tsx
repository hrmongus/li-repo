import { getVertical } from '../vertical';
import { AppsUpload } from './AppsUpload';
import { MusicUpload } from './MusicUpload';

/** Upload follows the Music | Apps switch in the header. */
export default async function UploadPage() {
  return (await getVertical()) === 'apps' ? <AppsUpload /> : <MusicUpload />;
}
