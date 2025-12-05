// ==UserScript==
// @name         Lichess Automated (Color Fixed)
// @description  Automated Lichess bot that reliably detects player color
// @author       Nuro
// @match        *://lichess.org/*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/reductionfear/lichessb/refs/heads/main/stockfish8.asm.js
// ==/UserScript==

let chessEngine;
let currentFen = "";
let bestMove;
let webSocketWrapper = null;
let gameId = null;
let isWhite = null; // Start as null to prevent guessing
let currentAck = 0;
let timeLimitMs = 100;

function initializeChessEngine() {
    console.log('Initializing Stockfish...');
    const stockfish = window.STOCKFISH();
    stockfish.postMessage("uci");
    stockfish.postMessage("setoption name Skill Level value 20");
    stockfish.postMessage("setoption name Threads value 2");
    stockfish.postMessage("ucinewgame");

    chessEngine = {
        postMessage: function(cmd) { stockfish.postMessage(cmd); },
        set onmessage(handler) { stockfish.onmessage = handler; }
    };
}

function completeFen(partialFen) {
    let fenParts = partialFen.split(' ');
    if (fenParts.length === 6) return partialFen;
    if (fenParts.length === 2) fenParts.push('KQkq');
    if (fenParts.length === 3) fenParts.push('-');
    if (fenParts.length === 4) fenParts.push('0');
    if (fenParts.length === 5) fenParts.push('1');
    return fenParts.join(' ');
}

// Reliable Color Detection using DOM classes
function updatePlayerColor() {
    // Check 1: Lichess Body Classes (Most Reliable)
    if (document.body) {
        if (document.body.classList.contains('orientation-white')) {
            isWhite = true;
            return true;
        }
        if (document.body.classList.contains('orientation-black')) {
            isWhite = false;
            return true;
        }
    }

    // Check 2: Board Wrapper Class
    const board = document.querySelector('.cg-wrap');
    if (board) {
        if (board.classList.contains('orientation-white')) {
            isWhite = true;
            return true;
        }
        if (board.classList.contains('orientation-black')) {
            isWhite = false;
            return true;
        }
    }

    // Check 3: Global Lichess Object (Fallback)
    if (window.lichess && window.lichess.orientation) {
        isWhite = (window.lichess.orientation === 'white');
        return true;
    }

    return false; // Could not detect yet
}

function interceptWebSocket() {
    let webSocket = window.WebSocket;
    const webSocketProxy = new Proxy(webSocket, {
        construct: function (target, args) {
            let wrappedWebSocket = new target(...args);
            webSocketWrapper = wrappedWebSocket;

            wrappedWebSocket.addEventListener("message", function (event) {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch (e) { return; }

                // 1. GAME START
                if (message.type === "gameFull" && message.id) {
                    gameId = message.id;
                    updatePlayerColor(); // Try to detect immediately
                    console.log("Game Full. Detected Color:", isWhite === null ? "Unknown" : (isWhite ? "White" : "Black"));

                    if (message.state) {
                        currentAck = message.state.ply;
                        let isWhitesTurn = message.state.ply % 2 === 0;

                        // Only move if we are sure of our color
                        if (isWhite !== null && isWhitesTurn === isWhite) {
                            currentFen = completeFen(message.fen);
                            setTimeout(calculateMove, 1000);
                        }
                    }
                }

                // 2. MOVES / UPDATES
                if (message.t === 'move' || message.t === 'd') {
                    // Always try to update color if we haven't yet
                    if (isWhite === null) updatePlayerColor();

                    if (message.d && typeof message.d.ply !== 'undefined') {
                        currentAck = message.d.ply;
                    }

                    if (message.d && typeof message.d.fen === "string") {
                        currentFen = message.d.fen;

                        let isWhitesTurn = message.d.ply % 2 === 0;

                        // Add turn indicator to FEN
                        currentFen += isWhitesTurn ? " w" : " b";
                        currentFen = completeFen(currentFen);

                        // STRICT CHECK:
                        // 1. We must know our color (isWhite !== null)
                        // 2. It must be our turn
                        if (isWhite !== null && isWhitesTurn === isWhite) {
                            calculateMove();
                        } else {
                            console.log("Skipping move: Not my turn or color unknown.");
                        }
                    }
                }
            });
            return wrappedWebSocket;
        }
    });
    window.WebSocket = webSocketProxy;
}

function calculateMove() {
    let thinkingTime = Math.floor(Math.random() * 500) + 200;
    setTimeout(() => {
        chessEngine.postMessage("position fen " + currentFen);
        chessEngine.postMessage(`go depth 8 movetime ${timeLimitMs}`);
    }, thinkingTime);
}

function setupChessEngineOnMessage() {
    chessEngine.onmessage = function (event) {
        if (event && event.includes("bestmove")) {
            let bestMove = event.split(" ")[1];
            let realisticLag = Math.floor(Math.random() * 200) + 100;

            let payload = {
                t: "move",
                d: {
                    u: bestMove,
                    a: currentAck,
                    b: 0,
                    l: realisticLag
                }
            };

            setTimeout(() => {
                if (webSocketWrapper && webSocketWrapper.readyState === 1) {
                    webSocketWrapper.send(JSON.stringify(payload));
                    console.log(`Sent Move: ${bestMove} | Ack: ${currentAck}`);
                }
            }, realisticLag);
        }
    };
}

initializeChessEngine();
interceptWebSocket();
setupChessEngineOnMessage();
