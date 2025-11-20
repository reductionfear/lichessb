// ==UserScript==
// @name         lichessmove-zerofish
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Lichess move with ZeroFish
// @author       Your Name
// @match        *://lichess.org/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(async function() {
    const response = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://example.com/path/to/zerofish.js',
            onload: function(res) {
                if (res.status === 200) {
                    resolve(res.responseText);
                } else {
                    reject(new Error('Failed to fetch zerofish.js')); 
                }
            },
            onerror: function(err) {
                reject(err);
            }
        });
    });
    
    const script = document.createElement('script');
    script.textContent = response; // Insert fetched script into a non-module script tag
    document.head.appendChild(script);  // Evaluate it in the context of the page

    // Your existing code that uses the ZeroFish module goes here.
})();
