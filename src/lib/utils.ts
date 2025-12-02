import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export const IST_TIMEZONE = 'Asia/Kolkata';

export const convertUTCToISTString = (date: Date): string => {
    const istDate = new TZDate(date, IST_TIMEZONE);
    return format(istDate, 'yyyy-MM-dd hh:mm:ss a');
};