/**
 * Format phone number for display
 * Handles Qatar (+974) and international formats
 */
export function formatPhoneDisplay(phone: string | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('974')) {
        return `+${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 8) {
        return `+974 ${digits.slice(0, 4)} ${digits.slice(4)}`;
    }
    return phone;
}

export default formatPhoneDisplay;
