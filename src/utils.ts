const htmlspecialchars = (unsafeText: string) => {
    return unsafeText.replace(
        /[&'`"<>]/g, 
        (match) => {
            return {
                '&': '&amp;',
                "'": '&#x27;',
                '`': '&#x60;',
                '"': '&quot;',
                '<': '&lt;',
                '>': '&gt;',
            }[match] || '';
        }
    );
};

const nl2br = (text: string) => {
    return text.replace(/\n/g, "<br>");
};

export { htmlspecialchars, nl2br };