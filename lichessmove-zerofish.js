// ==UserScript==
// @name         lichessmove-zerofish
// @description  Fully automated lichess bot with Zerofish engine
// @author       Nuro
// @match        *://lichess.org/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

let chessEngine;
let currentFen = "";
let bestMove;
let webSocketWrapper = null;
let gameId = null;
let isWhite = true;
let timeLimitMs = 50; // Time limit for engine calculations in milliseconds

async function loadZerofishModule() {
  // Dynamically load zerofish.js as a module
  const baseUrl = 'https://raw.githubusercontent.com/reductionfear/lichessb/refs/heads/main/';
  
  // Load the zerofish module
  const module = await import(baseUrl + 'zerofish.js');
  return module.default;
}

async function initializeChessEngine() {
  console.log('Initializing Zerofish engine...');
  
  try {
    // Load the Zerofish module
    const makeZerofish = await loadZerofishModule();
    
    // Create the Zerofish engine with locator function
    const baseUrl = 'https://raw.githubusercontent.com/reductionfear/lichessb/refs/heads/main/';
    const locator = (file) => baseUrl + file;
    
    const zerofish = await makeZerofish({
      locator,
      nonce: '',
      dev: false
    });
    
    // Create engine wrapper with UCI-like interface
    chessEngine = {
      zerofish: zerofish,
      currentPosition: null,
      
      postMessage: async function(cmd) {
        console.log('Zerofish command:', cmd);
        
        if (cmd === "uci") {
          // Initialize UCI mode
          setTimeout(() => this.onmessageHandler && this.onmessageHandler("uciok"), 10);
        } else if (cmd.startsWith("setoption")) {
          // Handle options (Zerofish has different options than Stockfish)
          setTimeout(() => this.onmessageHandler && this.onmessageHandler(""), 10);
        } else if (cmd === "ucinewgame") {
          // New game
          this.zerofish.newGame();
          setTimeout(() => this.onmessageHandler && this.onmessageHandler("readyok"), 10);
        } else if (cmd.startsWith("position")) {
          // Store position for later use
          this.currentPosition = this.parsePosition(cmd);
        } else if (cmd.startsWith("go")) {
          // Execute search
          await this.search(cmd);
        }
      },
      
      parsePosition: function(cmd) {
        // Parse "position fen <fen>" or "position startpos moves ..."
        const parts = cmd.split(' ');
        let fen = null;
        let moves = [];
        
        if (parts[1] === 'fen') {
          // Extract FEN (next 6 parts typically)
          const fenStart = 2;
          const fenParts = [];
          for (let i = fenStart; i < parts.length && parts[i] !== 'moves'; i++) {
            fenParts.push(parts[i]);
          }
          fen = fenParts.join(' ');
          
          // Extract moves if present
          const movesIndex = parts.indexOf('moves');
          if (movesIndex !== -1) {
            moves = parts.slice(movesIndex + 1);
          }
        } else if (parts[1] === 'startpos') {
          fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
          const movesIndex = parts.indexOf('moves');
          if (movesIndex !== -1) {
            moves = parts.slice(movesIndex + 1);
          }
        }
        
        return { fen, moves };
      },
      
      search: async function(cmd) {
        if (!this.currentPosition) {
          console.error('No position set');
          return;
        }
        
        // Parse search parameters
        const parts = cmd.split(' ');
        let searchParams = { movetime: 1000 }; // default
        
        for (let i = 1; i < parts.length; i++) {
          if (parts[i] === 'movetime' && i + 1 < parts.length) {
            searchParams.movetime = parseInt(parts[i + 1]);
          } else if (parts[i] === 'depth' && i + 1 < parts.length) {
            searchParams.depth = parseInt(parts[i + 1]);
          }
        }
        
        try {
          // Use the fish engine (Stockfish variant in Zerofish)
          const result = await this.zerofish.goFish(this.currentPosition, {
            multipv: 1,
            by: searchParams.depth 
              ? { depth: searchParams.depth }
              : { movetime: searchParams.movetime }
          });
          
          if (result && result.bestmove) {
            this.onmessageHandler && this.onmessageHandler(`bestmove ${result.bestmove}`);
          }
        } catch (error) {
          console.error('Search error:', error);
        }
      },
      
      onmessageHandler: null,
      
      set onmessage(handler) {
        this.onmessageHandler = handler;
      }
    };
  } catch (error) {
    console.error('Failed to load Zerofish module:', error);
    throw error;
  }
}

function completeFen(partialFen) {
    // Complete a partial FEN string to support castling
    // A full FEN has 6 parts: pieces, turn, castling, en-passant, halfmove, fullmove
    // Lichess typically sends only the first 2 parts (pieces and turn)
    
    let fenParts = partialFen.split(' ');
    
    // If we already have a complete FEN, return it
    if (fenParts.length === 6) {
        return partialFen;
    }
    
    // Add castling rights (assume all castling is available)
    if (fenParts.length === 2) {
        fenParts.push('KQkq'); // Castling availability
    }
    
    // Add en passant target square (- means no en passant)
    if (fenParts.length === 3) {
        fenParts.push('-');
    }
    
    // Add halfmove clock (for 50-move rule, start at 0)
    if (fenParts.length === 4) {
        fenParts.push('0');
    }
    
    // Add fullmove number (start at 1)
    if (fenParts.length === 5) {
        fenParts.push('1');
    }
    
    return fenParts.join(' ');
}

function interceptWebSocket() {
    let webSocket = window.WebSocket;
    const webSocketProxy = new Proxy(webSocket, {
        construct: function (target, args) {
            let wrappedWebSocket = new target(...args);
            webSocketWrapper = wrappedWebSocket;

            // ---- MODIFICATION START ----
            wrappedWebSocket.addEventListener("message", function (event) {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch (e) {
                    return; // Ignore non-JSON messages
                }

                // Handle gameFull message for game initialization
                if (message.type === "gameFull" && message.id) {
                    gameId = message.id;
                    isWhite = message.white.id === lichess.socket.settings.userId;
                    console.log("Game ID:", gameId);
                    console.log("Playing as white:", isWhite);
                }

                // Handle game end
                if (message.type === "gameState" && message.status >= 30) {
                    handleGameEnd();
                }

                // Use the message type 't' to decide what to do
                switch (message.t) {
                    // This is a "fall-through" case.
                    // It will execute the same code for both 'd' and 'move' types.
                    case 'd':
                    case 'move':
                        console.log("Received game state/move update:", message.t, message);

                        // The important check: Does this message contain the board state?
                        if (message.d && typeof message.d.fen === "string") {
                            currentFen = message.d.fen;

                            // 'ply' is a counter that helps determine whose turn it is.
                            // If ply is odd, it's Black's turn to move. If even, it's White's.
                            // The FEN is for the position BEFORE the move in the message,
                            // so we need to know whose turn it is now.
                            let isWhitesTurn = message.d.ply % 2 === 0;

                            if (isWhitesTurn) {
                                currentFen += " w";
                            } else {
                                currentFen += " b";
                            }

                            // Complete the FEN string with castling rights and other fields
                            // to enable castling moves
                            currentFen = completeFen(currentFen);

                            // We have the FEN, now calculate the move
                            calculateMove();
                        }
                        break;

                    case 'clockInc':
                        console.log("Clock increment received. Ignoring.", message.d);
                        break;

                    case 'crowd':
                    case 'mlat':
                        // Also ignore crowd (spectator) and latency updates
                        break;

                    default:
                        // Log any other message types for debugging
                        console.log("Received unhandled message type:", message.t, message);
                }
            });
            // ---- MODIFICATION END ----

            return wrappedWebSocket;
        }
    });

    window.WebSocket = webSocketProxy;
}

function calculateMove() {
    chessEngine.postMessage("position fen " + currentFen);
    chessEngine.postMessage(`go depth 2 movetime ${timeLimitMs}`);
    // chessEngine.postMessage(`go depth 1`); // Uncomment for depth 1 for immediate moves
}

function setupChessEngineOnMessage() {
    chessEngine.onmessage = function (event) {
        if (event && event.includes("bestmove")) {
            bestMove = event.split(" ")[1];
            webSocketWrapper.send(JSON.stringify({
                t: "move",
                d: { u: bestMove, b: 1, l: 10000, a: 1 }
            }));
        }
    };
}

function handleGameEnd() {
    console.log("Game ended, initiating rematch/new opponent...");
    // Option 1: Rematch
    // webSocketWrapper.send(JSON.stringify({ t: "rematch", d: gameId }));

    // Option 2: New opponent
    webSocketWrapper.send(JSON.stringify({ t: 'challenge', d: { dest: 'auto', rated: !1, clock: { limit: 60, increment: 5, emerg: 30 } } }));
}

// Initialize engine asynchronously
initializeChessEngine().then(() => {
    console.log('Zerofish engine initialized');
    interceptWebSocket();
    setupChessEngineOnMessage();
}).catch((error) => {
    console.error('Failed to initialize Zerofish engine:', error);
});
