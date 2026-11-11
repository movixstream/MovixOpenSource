import { readSessionStorage } from './browserStorage';
import { getNumericDateParts } from './dateParts';

const APRIL_FOOLS_TIMEZONE = 'Europe/Paris';
const APRIL_FOOLS_PREVIEW_QUERY = 'apriladmin';
const APRIL_FOOLS_PREVIEW_STORAGE_KEY = 'movix_april_admin_preview';

const aprilFoolsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: APRIL_FOOLS_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});

export const APRIL_FOOLS_ADMIN_PATH = '/admin-control-center';

const getMonthDay = (date: Date) => {
  const { day = '', month = '' } = getNumericDateParts(aprilFoolsFormatter, date);

  return { day, month };
};

export const isAprilFoolsDay = (date = new Date()) => {
  const { day, month } = getMonthDay(date);
  return day === '01' && month === '04';
};

const readPreviewFlag = (search: string) => {
  if (typeof window === 'undefined') {
    return false;
  }

  const params = new URLSearchParams(search);
  const previewValue = params.get(APRIL_FOOLS_PREVIEW_QUERY);

  if (previewValue === '1') {
    try { sessionStorage.setItem(APRIL_FOOLS_PREVIEW_STORAGE_KEY, 'true'); } catch { /* Prévisualisation limitée à cette URL. */ }
    return true;
  }

  if (previewValue === '0') {
    try { sessionStorage.removeItem(APRIL_FOOLS_PREVIEW_STORAGE_KEY); } catch { /* Le paramètre reste prioritaire. */ }
    return false;
  }

  return readSessionStorage(APRIL_FOOLS_PREVIEW_STORAGE_KEY) === 'true';
};

export const isAprilFoolsAdminEnabled = (search = '') => {
  if (isAprilFoolsDay()) {
    return true;
  }

  return readPreviewFlag(search);
};
