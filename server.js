const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const questionFormats = require('./questionFormats');
const questionFormatsBlitzStandard = require('./questionFormatsBlitzStandard');
const questionFormatsBlitzComplex = require('./questionFormatsBlitzComplex');

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    fs.readFile('index.html', (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error loading index.html');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});

const io = socketIo(server);

const games = {}; // Store game state for each room
const playerSockets = {}; // Map player names to socket IDs

function logWithTimestamp(...args) {
    const timestamp = new Date().toTimeString().split(' ')[0]; // HH:MM:SS
    console.log(`[${timestamp}]`, ...args);
}

function getStatsKey(game, question) {
    // ✅ Standard modes — return raw category (unchanged)
    if (!game?.gameSettings?.isBlitz) {
        return question?.category || 'uncategorized';
    }

    // ✅ Blitz mode — special handling for list-type questions
    if (question?.type === 'list') {
        if (question?.formatName) {
            return `blitzList_${question.formatName}`;
        }

        const key = (question?.key || '').toLowerCase();
        if (key === 'factorization') return 'blitzList_Factorization';
        if (key === 'sumofsquares') return 'blitzList_SumOfSquares';
        if (key === 'systemofequations') return 'blitzList_SystemOfEquations';

        // 🔁 Fallback if formatName is missing (e.g. skipped question)
        const sub = (question?.subCategory || '').toLowerCase();
        if (sub === 'factorization') return 'blitzList_Factorization';
        if (sub === 'sumofsquares') return 'blitzList_SumOfSquares';
        if (sub === 'systemofequations') return 'blitzList_SystemOfEquations';

        return 'blitzList_UNKNOWN';
    }


    // ✅ All other Blitz-mode questions already have properly formatted categories — return as-is
    return question?.category || 'uncategorized';
}

function generateRandomNumber(numDigits) {
    numDigits = Math.max(1, numDigits);
    const min = Math.pow(10, numDigits - 1);
    const max = Math.pow(10, numDigits) - 1;
    return getRandomInt(min, max);
}

io.on('connection', (socket) => {
    logWithTimestamp(`A user connected. Socket ID: ${socket.id}`);

    setTimeout(() => {
        const waitingPlayers = findWaitingPlayers();
        if (waitingPlayers.length > 0) {
            let waitingMessage = waitingPlayers.map(({ roomName, playerName, gameSettings }) => {
                let settingsDescription = gameSettings && gameSettings.isLeagueMatch ?
                    "League Match" :
                    `Number of Questions: ${gameSettings ? gameSettings.numQuestions : ''}`;
                let modeDescription = gameSettings ? gameSettings.selectedMode : '';
                return `${playerName} is waiting in ${roomName} - Mode: ${modeDescription}, Settings: ${settingsDescription}`;
            }).join('\n'); // Join all messages with a newline

            socket.emit('playerWaiting', waitingMessage);
        }
    }, 3000);

    socket.on('joinRoom', (roomName, playerName) => {
        playerSockets[playerName] = socket.id;
        socket.join(roomName);

        if (!games[roomName]) {
            logWithTimestamp(`Room ${roomName} does not exist or was cleared. Creating a new room.`);
            games[roomName] = {
                players: {},
                questions: [],
                playerQuestionIndices: {},
                scores: {},
                gameStarted: false,
                gameSettings: {},
                playerStats: {},
                attempts: {},
                blitzStats: null
            };
        }
        
        const room = games[roomName];

        if (!(playerName in room.players)) {
            logWithTimestamp(`Player ${playerName} joined room ${roomName}. Players in room: ${Object.keys(room.players)}`);
            room.players[playerName] = playerName;
            room.scores[playerName] = 0;
            room.playerQuestionIndices[playerName] = 0;
            room.attempts[playerName] = {};
    
            room.playerStats[playerName] = {
                smallRandomQuestions: { correct: 0, total: 0, totalTime: 0 },
                mediumRandomQuestions: { correct: 0, total: 0, totalTime: 0 },
                largeRandomQuestions: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to9_small: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to9_medium: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to9_large: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to99_small: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to99_medium: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to99_large: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to999_small: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to999_medium: { correct: 0, total: 0, totalTime: 0 },
                blitzRandom_1to999_large: { correct: 0, total: 0, totalTime: 0 },
                listQuestions: { correct: 0, total: 0, totalTime: 0 },
                additionLevel1: { correct: 0, total: 0, totalTime: 0 },
                additionLevel2: { correct: 0, total: 0, totalTime: 0 },
                additionLevel3: { correct: 0, total: 0, totalTime: 0 },
                additionLevel4: { correct: 0, total: 0, totalTime: 0 },
                additionLevel5: { correct: 0, total: 0, totalTime: 0 },
                multiplicationLevel1: { correct: 0, total: 0, totalTime: 0 },
                multiplicationLevel2: { correct: 0, total: 0, totalTime: 0 },
                multiplicationLevel3: { correct: 0, total: 0, totalTime: 0 },
                multiplicationLevel4: { correct: 0, total: 0, totalTime: 0 },
                multiplicationLevel5: { correct: 0, total: 0, totalTime: 0 },
                divisionLevel1: { correct: 0, total: 0, totalTime: 0 },
                divisionLevel2: { correct: 0, total: 0, totalTime: 0 },
                divisionLevel3: { correct: 0, total: 0, totalTime: 0 },
                divisionLevel4: { correct: 0, total: 0, totalTime: 0 },
                divisionLevel5: { correct: 0, total: 0, totalTime: 0 },
                modLevel1: { correct: 0, total: 0, totalTime: 0 },
                modLevel2: { correct: 0, total: 0, totalTime: 0 },
                modLevel3: { correct: 0, total: 0, totalTime: 0 },
                modLevel4: { correct: 0, total: 0, totalTime: 0 },
                modLevel5: { correct: 0, total: 0, totalTime: 0 },
                squareRootLevel1: { correct: 0, total: 0, totalTime: 0 },
                squareRootLevel2: { correct: 0, total: 0, totalTime: 0 },
                squareRootLevel3: { correct: 0, total: 0, totalTime: 0 },
                squareRootLevel4: { correct: 0, total: 0, totalTime: 0 },
                squareRootLevel5: { correct: 0, total: 0, totalTime: 0 },
                nthRootLevel1: { correct: 0, total: 0, totalTime: 0 },
                nthRootLevel2: { correct: 0, total: 0, totalTime: 0 },
                nthRootLevel3: { correct: 0, total: 0, totalTime: 0 },
                nthRootLevel4: { correct: 0, total: 0, totalTime: 0 },
                nthRootLevel5: { correct: 0, total: 0, totalTime: 0 },
                factorizationLevel1: { correct: 0, total: 0, totalTime: 0 },
                factorizationLevel2: { correct: 0, total: 0, totalTime: 0 },
                factorizationLevel3: { correct: 0, total: 0, totalTime: 0 },
                factorizationLevel4: { correct: 0, total: 0, totalTime: 0 },
                factorizationLevel5: { correct: 0, total: 0, totalTime: 0 },
                sumOfSquaresLevel1: { correct: 0, total: 0, totalTime: 0 },
                sumOfSquaresLevel2: { correct: 0, total: 0, totalTime: 0 },
                sumOfSquaresLevel3: { correct: 0, total: 0, totalTime: 0 },
                sumOfSquaresLevel4: { correct: 0, total: 0, totalTime: 0 },
                sumOfSquaresLevel5: { correct: 0, total: 0, totalTime: 0 },
                decimalRootsLevel1: { correct: 0, total: 0, totalTime: 0 },
                decimalRootsLevel2: { correct: 0, total: 0, totalTime: 0 },
                decimalRootsLevel3: { correct: 0, total: 0, totalTime: 0 },
                decimalRootsLevel4: { correct: 0, total: 0, totalTime: 0 },
                decimalRootsLevel5: { correct: 0, total: 0, totalTime: 0 },
                decimalExponentsLevel1: { correct: 0, total: 0, totalTime: 0 },
                decimalExponentsLevel2: { correct: 0, total: 0, totalTime: 0 },
                decimalExponentsLevel3: { correct: 0, total: 0, totalTime: 0 },
                decimalExponentsLevel4: { correct: 0, total: 0, totalTime: 0 },
                decimalExponentsLevel5: { correct: 0, total: 0, totalTime: 0 }
            };
            const blitzListCategoriesStandard = Object.keys(questionFormatsBlitzStandard);
            const blitzListCategoriesComplex = Object.keys(questionFormatsBlitzComplex);
            for (const category of [...blitzListCategoriesStandard, ...blitzListCategoriesComplex]) {
            const key = `blitzList_${category}`;
            room.playerStats[playerName][key] = { correct: 0, total: 0, totalTime: 0 };
}
const specialBlitzKeys = ['blitzList_Factorization', 'blitzList_SumOfSquares', 'blitzList_SystemOfEquations'];
for (const key of specialBlitzKeys) {
    room.playerStats[playerName][key] = { correct: 0, total: 0, totalTime: 0 };
}

        } else {
            logWithTimestamp(`Player ${playerName} rejoining room ${roomName}`);
            io.to(playerSockets[playerName]).emit('playerRejoined', playerName);

            if (!(playerName in room.playerQuestionIndices)) {
                room.playerQuestionIndices[playerName] = 0;
            }

            if (Object.keys(room.players).length === 2) {
                io.to(socket.id).emit('enableSkipForOneQuestion', playerName);
            }
        }
        const gameSettings = room.gameSettings;
        if (gameSettings.isLeagueMatch) {
            if (Object.keys(room.players).length === 2 && !room.gameStarted) {
            }
        }
    });

    socket.on('startGame', (roomName, gameSettings) => {
        const game = games[roomName];
    
        if (!game || game.gameStarted) {
            return;
        }
    
        game.gameSettings = gameSettings || {};
        const settings = game.gameSettings; // Ensure settings is defined
        const isBlitzMode = ['blitzRegularSeason', 'blitzPlayoffs', 'blitzFinals'].includes(settings.selectedMode);
        if (!game.blitzMatchHistory && isBlitzMode) {
            game.blitzMatchHistory = []; // Only initialize once, at match start
        }
            
        const customFormatQuestionPercentage = settings.isLeagueMatch 
            ? Math.random() * 0.4 + 0.17 // Randomize between 10% and 50% for league matches
            : settings.customFormatQuestionPercentage || 0.2; // Default to user-provided or 20%
        settings.customFormatQuestionPercentage = customFormatQuestionPercentage;
        
        const numQuestions = settings.isLeagueMatch ? 500 : settings.numQuestions || 10;
        game.questions = generateQuestionsForRoom(settings.selectedMode, numQuestions, customFormatQuestionPercentage, roomName);
    
        if (settings.isLeagueMatch && Object.keys(game.players).length < 2) {
            return;
        }
    
        let countdown = settings.isLeagueMatch ? 30 : 5;

        const countdownInterval = setInterval(() => {
            io.to(roomName).emit('countdown', countdown);
            countdown--;
            if (countdown < 0) {
                clearInterval(countdownInterval);
    
                settings.customFormatQuestionPercentage = customFormatQuestionPercentage;
                    
                if (settings.selectedMode === 'additionTenDigit') {
                    game.questions = generateAdditionQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('multiplication')) {
                    game.questions = generateMultiplicationQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('division')) {
                    game.questions = generateDivisionQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('mod')) {
                    game.questions = generateModQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('squareRoots')) {
                    game.questions = generateSquareRootQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('nthRoots')) {
                    game.questions = generateNthRootQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('factorization')) {
                    game.questions = generateFactorizationQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('sumOfSquares')) {
                    game.questions = generateSumOfSquaresQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('decimalRoots')) {
                    game.questions = generateDecimalRootsQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('decimalExponents')) {
                    game.questions = generateDecimalExponentsQuestions(numQuestions, settings.taskLevel);
                } else {
                    game.questions = generateQuestionsForRoom(settings.selectedMode, numQuestions, customFormatQuestionPercentage, roomName);
                }
    
                game.gameStarted = true;
                game.startTime = Date.now(); // Set start time for the game
    
                logWithTimestamp(`Game started in room ${roomName}. Start time: ${game.startTime}`);
                io.to(roomName).emit('gameStarted', { startTime: game.startTime });
    
                for (const playerName in game.players) {
                    if (!(playerName in game.playerQuestionIndices)) {
                        game.playerQuestionIndices[playerName] = 0;
                    }
                }
                for (const playerName in game.players) {
                    if (!(playerName in game.playerQuestionIndices)) {
                        game.playerQuestionIndices[playerName] = 0;
                    }
                    if (!(playerName in game.scores)) {
                        game.scores[playerName] = 0;
                    }
                }
                
                sendQuestionToRoom(roomName);
            }
        }, 1000);
    });
    
    socket.on('requestCurrentGameState', (roomName, playerName) => {
        if (games[roomName] && games[roomName].players[playerName]) {
            const playerSocketId = playerSockets[playerName];
            const gameStartTime = games[roomName].startTime;
            const currentTime = Date.now();

            if (typeof gameStartTime === 'number' && gameStartTime <= currentTime) {
                const elapsedTime = Math.round((currentTime - gameStartTime) / 1000);

                const gameState = {
                    scores: games[roomName].scores,
                    elapsedTime: elapsedTime,
                    timeLeftForNextQuestion: games[roomName].gameSettings.isLeagueMatch ? 30 : 60,
                    startTime: gameStartTime,
                    gameStarted: games[roomName].gameStarted
                };

                io.to(playerSocketId).emit('currentGameState', gameState);
            } else {
                logWithTimestamp(`Invalid or missing startTime in game state for ${playerName} in room ${roomName}`);
            }
        } else {
            logWithTimestamp(`Game or player not found for ${playerName} in room ${roomName}`);
        }
    });
    
    socket.on('submitAnswer', (roomName, submittedAnswer, playerName) => {
        logWithTimestamp(`[SERVER] Received 'submitAnswer' from ${socket.id} — Room: ${roomName}, Answer: ${submittedAnswer}, Player: ${playerName}`);
    
        const game = games[roomName];
        if (!game) {
            logWithTimestamp(`[submitAnswer] No game found for room: ${roomName}`);
            return;
        }
    
        if (!game.players[playerName]) {
            logWithTimestamp(`[submitAnswer] Player '${playerName}' not found in game.players`);
            return;
        }
    
        if (game.intermissionActive) {
            logWithTimestamp(`[Answer Ignored] Intermission active. Answer from ${playerName} not processed.`);
            return;
        }
    
        const playerIndex = game.playerQuestionIndices[playerName];
        logWithTimestamp(`[submitAnswer] ${playerName} submitting for index ${playerIndex}`);
        logWithTimestamp(`[submitAnswer] Full question object: ${JSON.stringify(game.questions[playerIndex])}`);

        if (playerIndex >= game.questions.length) {
            logWithTimestamp(`[submitAnswer] Player '${playerName}' has exhausted questions (index ${playerIndex})`);
            return;
        }    
        logWithTimestamp(`[submitAnswer] Passed all early checks. Proceeding with question index ${playerIndex}`);
    
    
        if (!game.attempts[playerName]) game.attempts[playerName] = {};
        if (!game.attempts[playerName][playerIndex]) game.attempts[playerName][playerIndex] = 0;
    
        if (!game.visualAttempts) game.visualAttempts = {};
        if (!game.visualAttempts[playerName]) game.visualAttempts[playerName] = {};
        if (!game.visualAttempts[playerName][playerIndex]) game.visualAttempts[playerName][playerIndex] = 0;
    
        const attempts = game.attempts[playerName][playerIndex];
        if (attempts >= 5) {
            logWithTimestamp(`[Blocked] ${playerName} has already submitted ${attempts} attempts for index ${playerIndex}`);
            return;
        }
                
        game.attempts[playerName][playerIndex]++;
        game.visualAttempts[playerName][playerIndex]++;
    
        const sharedQuestion = game.questions[playerIndex]; // DO NOT mutate this object
        if (!sharedQuestion) {
            logWithTimestamp(`[Error] sharedQuestion is undefined for player ${playerName} at index ${playerIndex}`);
            return;
        }        
        const correctAnswer = sharedQuestion.answer;
        const sendTimeKey = `${roomName}_${playerName}_${playerIndex}`;
        const sendTime = questionSendTimes[sendTimeKey];
        logWithTimestamp(`[submitAnswer] sendTimeKey: ${sendTimeKey}, sendTime: ${sendTime}`);

        let isCorrect = false;

        logWithTimestamp(`[Before Eval] Will now evaluate answer for player: ${playerName} at index ${playerIndex}, answer: ${submittedAnswer}`);

        try {
            logWithTimestamp(`[Eval Start] Player: ${playerName}, Answer: ${submittedAnswer}`);
            logWithTimestamp(`[Eval Start] Question: ${sharedQuestion.text}`);
            logWithTimestamp(`[Eval Start] Correct Answer: ${correctAnswer}`);
    
            const evalResultRaw = evaluateAnswer(sharedQuestion, submittedAnswer);
            isCorrect = (typeof evalResultRaw === 'boolean') ? evalResultRaw : false;
    
            if (typeof evalResultRaw !== 'boolean') {
                logWithTimestamp(`[Warning] evaluateAnswer returned non-boolean for ${playerName}: ${evalResultRaw}`);
            }
    
            logWithTimestamp(`[EvalResult] evaluateAnswer returned: ${evalResultRaw} → interpreted as: ${isCorrect}`);
            logWithTimestamp(`[Eval End] Result: ${isCorrect ? "Correct" : "Incorrect"}`);
            logWithTimestamp(`[Eval End] Question JSON (after eval): ${JSON.stringify(sharedQuestion)}`);
    
            let statsKey = sharedQuestion.category;
            if (game.gameSettings.isBlitz && sharedQuestion.type === 'list') {
                if (sharedQuestion.formatName) {
                    statsKey = `blitzList_${sharedQuestion.formatName}`;
                } else if (sharedQuestion.subCategory) {
                    let keyMap = {
                        factorization: 'Factorization',
                        sumOfSquares: 'SumOfSquares',
                        systemsOfEquations: 'SystemOfEquations'
                    };
                    const mappedKey = keyMap[sharedQuestion.subCategory];
                    if (mappedKey) {
                        statsKey = `blitzList_${mappedKey}`;
                    } else {
                        console.warn(`Unknown subCategory for Blitz list question:`, sharedQuestion);
                        return;
                    }
                } else {
                    console.warn(`Missing formatName and subCategory for Blitz list question:`, sharedQuestion);
                    return;
                }
            }
                
            if (!statsKey || typeof statsKey !== 'string') {
                console.error(`Invalid statsKey for player ${playerName}`, sharedQuestion);
                return;
            }
    
            if (!game.playerStats[playerName]) {
                game.playerStats[playerName] = {};
            }
    
            if (!Object.prototype.hasOwnProperty.call(game.playerStats[playerName], statsKey)) {
                console.warn(`[Stats Init] Creating playerStats[${playerName}][${statsKey}]`);
                game.playerStats[playerName][statsKey] = { correct: 0, total: 0, totalTime: 0 };
            }
        
            if (!questionTimes[playerName]) questionTimes[playerName] = [];
    
            if (isCorrect) {
                const timeSpent = sendTime ? (Date.now() - sendTime) / 1000 : 0;
            
                questionTimes[playerName][playerIndex] = {
                    question: sharedQuestion.text,
                    time: timeSpent,
                    skipped: false,
                    submittedAnswer: submittedAnswer || null,
                    correctAnswer: sharedQuestion.answer,
                    isCorrect: true
                };
            
                // ✅ Correct answer: update stats here
                game.playerStats[playerName][statsKey].correct += 1;
                game.playerStats[playerName][statsKey].total += 1;
                game.playerStats[playerName][statsKey].totalTime += timeSpent;
    
                game.scores[playerName]++;
                game.playerQuestionIndices[playerName]++;
                game.visualAttempts[playerName][playerIndex] = 0;
    
                logWithTimestamp(`[Answer Accepted] ${playerName} → index now ${game.playerQuestionIndices[playerName]}, score: ${game.scores[playerName]}, time spent: ${timeSpent.toFixed(2)}s`);
    
                checkGameOver(roomName);
    
                if (game.playerQuestionIndices[playerName] < game.questions.length) {
                    sendQuestionToPlayer(roomName, playerName, game.playerQuestionIndices[playerName]);
                }
    
                io.to(playerSockets[playerName]).emit('updateSubmitButton', {
                    attempts: 0,
                    maxAttempts: 5
                });
            } else {
                const existing = questionTimes[playerName][playerIndex];
                if (!existing || existing.isCorrect !== true) {
                    questionTimes[playerName][playerIndex] = {
                        question: sharedQuestion.text,
                        time: 0,
                        skipped: false,
                        submittedAnswer: submittedAnswer || null,
                        correctAnswer: sharedQuestion.answer,
                        isCorrect: false
                    };
                }
            }
    
            const stat = game.playerStats[playerName]?.[statsKey];
            if (stat) {
                logWithTimestamp(`[Stat Updated] ${playerName} – ${statsKey} → ${stat.correct}/${stat.total}`);
            }
    
            const updatedScores = {};
            for (const [name, score] of Object.entries(game.scores)) {
                updatedScores[name] = score;
            }
    
            io.to(roomName).emit('scoreUpdate', updatedScores);
            io.to(playerSockets[playerName]).emit('updateSubmitButton', {
                attempts: game.visualAttempts[playerName][playerIndex],
                maxAttempts: 5
            });
    
            logWithTimestamp(`Player ${playerName} submitted an answer in room ${roomName}. Current score: ${game.scores[playerName]}`);
            resetRoomTimeout(roomName);
    
        } catch (err) {
            logWithTimestamp(`[Fatal Error] submitAnswer failed for ${playerName} in room ${roomName}: ${err.message}`);
            console.error(err);
        }
    });
                            
    socket.on('gameStats', (statsMessage) => {
        displayPlayerStats(statsMessage);
    });

    socket.on('requestRandomize', ({ roomName, type }) => {
        console.log(`[requestRandomize] Received request from socket ${socket.id} for type: ${type} in room: ${roomName}`);
        
        const game = games[roomName];
        if (!game) {
            console.warn(`[requestRandomize] No game found for room: ${roomName}`);
            return;
        }
    
        const mode = game.gameSettings?.selectedMode || 'blitzRegularSeason';
        const difficulty = determineDifficulty(mode);
    
        if (type === 'random') {
            console.log('[requestRandomize] Randomizing random format');
            game.blitzRandomFormatChosen = false;
            chooseFixedBlitzRandomFormatIfNeeded(roomName);
        } else if (type === 'standard') {
            console.log('[requestRandomize] Randomizing standard format');
            game.blitzFormatsChosen = false;
            game.selectedBlitzStandardCategory = getRandomCategoryByDifficulty(questionFormatsBlitzStandard, difficulty);
            game.blitzFormatsChosen = true;
        } else if (type === 'complex') {
            console.log('[requestRandomize] Randomizing complex format');
            game.blitzFormatsChosen = false;
            chooseFixedBlitzFormatsIfNeeded(roomName, false, true);
            const complex = game.selectedBlitzComplexCategory;
            if (!complex || (!complex.isSpecial && (!complex.formats || !Array.isArray(complex.formats)))) {
                console.warn(`[requestRandomize] ERROR: Failed to assign complex category properly: ${JSON.stringify(complex)}`);
            } else {
                console.log(`[requestRandomize] Successfully assigned complex category: ${complex.key || '(special)'}`);
            }
            game.blitzFormatsChosen = true;
        } else if (type === 'all') {
            console.log('[requestRandomize] Randomizing all formats');
            game.blitzFormatsChosen = false;
            game.blitzRandomFormatChosen = false;

            game.selectedBlitzStandardCategory = null;
            game.selectedBlitzComplexCategory = null;
            game.blitzRandomFormat = null;

            chooseFixedBlitzFormatsIfNeeded(roomName, true, true);
            chooseFixedBlitzRandomFormatIfNeeded(roomName);
            logWithTimestamp(`[requestRandomize] New standard: ${game.selectedBlitzStandardCategory?.key}`);
            logWithTimestamp(`[requestRandomize] New complex: ${game.selectedBlitzComplexCategory?.key}`);
            logWithTimestamp(`[requestRandomize] New random format: ${JSON.stringify(game.blitzRandomFormat)}`);
        } else {
            console.warn(`[requestRandomize] Invalid type: ${type}`);
            return;
        }
    
        const { numOperations, range } = game.blitzRandomFormat;
        const [min, max] = range;
        const rangeLabel = max <= 9 ? '1to9' : max <= 99 ? '1to99' : '1to999';
        const sizeLabel = numOperations <= 4 ? 'small' : numOperations <= 7 ? 'medium' : 'large';
        const randomCategoryLabel = `blitzRandom_${rangeLabel}_${sizeLabel}`;
    
        game.statCategories = [
            game.selectedBlitzStandardCategory?.key || 'Standard',
            game.selectedBlitzComplexCategory?.key || 'Complex',
            randomCategoryLabel
        ];

        console.log(`[requestRandomize] Updated stat categories:`);
        console.log(`  ↳ Standard: ${game.statCategories[0]}`);
        console.log(`  ↳ Complex: ${game.statCategories[1]}`);
        console.log(`  ↳ Random: ${game.statCategories[2]}`);
    
        io.to(roomName).emit('blitzFormatsUpdated', {
            standard: game.selectedBlitzStandardCategory?.key,
            complex: game.selectedBlitzComplexCategory?.key,
            random: randomCategoryLabel
        });
    });
    
    socket.on('timerExpired', (roomName, playerName) => {
        const game = games[roomName];

        if (!game) {
            logWithTimestamp(`[timerExpired] No game found for room: ${roomName}`);
            return;
        }
    
        if (game.intermissionActive) {
            logWithTimestamp(`[Timer Blocked] Intermission active — skipping timerExpired logic for ${playerName} in room ${roomName}`);
            return;
        }

        if (!game.playerQuestionIndices[playerName] && game.playerQuestionIndices[playerName] !== 0) {
            return;
        }

        if (game.playerQuestionIndices[playerName] >= game.questions.length) {
            return;
        }
        updatePlayerStats(roomName, playerName, game.playerQuestionIndices[playerName]);
        game.playerQuestionIndices[playerName]++;
        
        checkGameOver(roomName);

        if (game.playerQuestionIndices[playerName] < game.questions.length) {
            sendQuestionToPlayer(roomName, playerName, game.playerQuestionIndices[playerName]);
        }
    });
    socket.on('disconnect', () => {
        for (const [playerName, socketId] of Object.entries(playerSockets)) {
            if (socketId === socket.id) {
                delete playerSockets[playerName];
                logWithTimestamp(`[Disconnect] Removed socket mapping for ${playerName}`);
                break;
            }
        }
    });    
});

function findWaitingPlayers() {
    let waitingInfo = [];
    for (const [roomName, game] of Object.entries(games)) {
        if (Object.keys(game.players).length === 1 && game.gameSettings.isLeagueMatch) {
            const waitingPlayerName = Object.values(game.players)[0];
            if (game.gameSettings) {
                const { selectedMode, taskLevel, numQuestions, isLeagueMatch } = game.gameSettings;
                waitingInfo.push({
                    roomName,
                    playerName: waitingPlayerName,
                    gameSettings: {
                        selectedMode,
                        taskLevel,
                        numQuestions,
                        isLeagueMatch
                    }
                });
            } else {
                waitingInfo.push({
                    roomName,
                    playerName: waitingPlayerName,
                    gameSettings: null
                });
            }
        }
    }
    return waitingInfo;
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFloat(min, max, decimalPlaces) {
    const factor = Math.pow(10, decimalPlaces);
    return (Math.random() * (max - min) + min).toFixed(decimalPlaces);
}
const roomTimeouts = {};

function clearRoomData(roomName) {
    if (games[roomName]) {
        const game = games[roomName];
        logWithTimestamp(`Clearing data for room: ${roomName}`);

        if (roomTimeouts[roomName]) {
            clearTimeout(roomTimeouts[roomName]);
            delete roomTimeouts[roomName];
        }

        // Clear all player-specific data
        for (const playerName in game.players) {
            delete questionTimes[playerName];   // Clear the question times for the player
            delete game.playerStats[playerName]; // Clear player stats
            delete game.attempts[playerName];    // Clear player attempts
        }

        // Finally, delete the entire game state for the room
        delete games[roomName];
    }
}

function resetRoomTimeout(roomName) {
    const timeoutDuration = 10 * 60 * 1000; // 10 minutes in milliseconds

    // Clear any existing timeout for this room
    if (roomTimeouts[roomName]) {
        clearTimeout(roomTimeouts[roomName]);
    }

    // Set a new timeout
    roomTimeouts[roomName] = setTimeout(() => {
        logWithTimestamp(`No activity detected for 10 minutes in room: ${roomName}. Clearing room.`);
        clearRoomData(roomName);
    }, timeoutDuration);
}

function startGame(roomName, options = {}) {
    const game = games[roomName];
    if (game && !game.gameStarted && Object.keys(game.players).length >= 1) {
        const settings = game.gameSettings || {};
        const isBlitzMode = ['blitzRegularSeason', 'blitzPlayoffs', 'blitzFinals'].includes(settings.selectedMode);
        const skipCountdown = options.skipCountdown === true;
        let countdown = (settings.isLeagueMatch) ? 30 : 5;

        const beginGameLogic = () => {
                const customFormatQuestionPercentage = Math.random() * 0.4 + 0.17;
                settings.customFormatQuestionPercentage = customFormatQuestionPercentage;
                if (!isBlitzMode) {
                    logWithTimestamp(`Custom Format Question Percentage for room ${roomName}: ${listQuestionPercentage.toFixed(2)}`);
                }
                
                let numQuestions = settings.isLeagueMatch ? 500 : settings.numQuestions || 10;

                if (settings.selectedMode === 'additionTenDigit') {
                    game.questions = generateAdditionQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('multiplication')) {
                    game.questions = generateMultiplicationQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('division')) {
                    game.questions = generateDivisionQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('mod')) {
                    game.questions = generateModQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('squareRoots')) {
                    game.questions = generateSquareRootQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('nthRoots')) {
                    game.questions = generateNthRootQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('factorization')) {
                    game.questions = generateFactorizationQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('sumOfSquares')) {
                    game.questions = generateSumOfSquaresQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('decimalRoots')) {
                    game.questions = generateDecimalRootsQuestions(numQuestions, settings.taskLevel);
                } else if (settings.selectedMode.startsWith('decimalExponents')) {
                    game.questions = generateDecimalExponentsQuestions(numQuestions, settings.taskLevel);
                } else {
                    game.questions = generateQuestionsForRoom(settings.selectedMode, numQuestions, customFormatQuestionPercentage, roomName);
                }
                logWithTimestamp(`[startGame] Questions generated: ${game.questions.length} for room: ${roomName}`);
                game.gameStarted = true;
                game.startTime = Date.now(); // Set the start time for all games

                logWithTimestamp(`Game started in room ${roomName}. Start time: ${game.startTime}`);
                io.to(roomName).emit('gameStarted', { startTime: game.startTime });
                
               // Reset player progress and attempts for new mini-match
                game.attempts = {};
                game.visualAttempts = {};
                for (const playerName in game.players) {
                game.playerQuestionIndices[playerName] = 0;
                game.scores[playerName] = 0;
                game.attempts[playerName] = {};
                game.visualAttempts[playerName] = {};
}             
                sendQuestionToRoom(roomName);
            };
            if (skipCountdown) {
                beginGameLogic();
            } else {
                logWithTimestamp(`[startGame] Countdown started in room: ${roomName}`);
                const countdownInterval = setInterval(() => {
                    io.to(roomName).emit('countdown', countdown);
                    countdown--;
                    if (countdown < 0) {
                        clearInterval(countdownInterval);
                        beginGameLogic();
                    }
                }, 1000);
            }
        }
    }
    

function generateAdditionQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: 2,
        2: 4,
        3: 6,
        4: 10,
        5: 15
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        let numbers = [];
        for (let j = 0; j < 10; j++) {
            numbers.push(generateRandomNumber(numDigits));
        }
        const questionText = numbers.join(' + ');
        const answer = numbers.reduce((acc, num) => acc + num, 0);
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `additionLevel${taskLevel}`
        });
    }
    return questions;
}

function generateMultiplicationQuestions(numQuestions, taskLevel) {
    const MAX_VALUE = Math.pow(2, 53);
    const questions = [];
    const digitLengths = {
        1: 2,
        2: 3,
        3: 5,
        4: 6,
        5: 8
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        let number1, number2, answer, questionText;

        do {
            number1 = generateRandomNumber(numDigits);
            number2 = generateRandomNumber(numDigits);
            answer = number1 * number2;
            questionText = `${number1} × ${number2}`;
        } while (Math.abs(answer) >= MAX_VALUE);

        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `multiplicationLevel${taskLevel}`
        });
    }
    return questions;
}

function generateDivisionQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: { num1: 3, num2: 1 },
        2: { num1: 5, num2: 3 },
        3: { num1: 10, num2: 5 },
        4: { num1: 15, num2: 7 },
        5: { num1: 20, num2: 10 }
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        let number1, number2;
        do {
            number1 = generateRandomNumber(numDigits.num1);
            number2 = generateRandomNumber(numDigits.num2);
        } while (number1 % number2 !== 0);

        const questionText = `${number1} ÷ ${number2}`;
        const answer = number1 / number2;
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `divisionLevel${taskLevel}`
        });
    }
    return questions;
}

function generateModQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: { num1: 3, num2: 1 },
        2: { num1: 5, num2: 3 },
        3: { num1: 10, num2: 5 },
        4: { num1: 15, num2: 7 },
        5: { num1: 20, num2: 10 }
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        const number1 = generateRandomNumber(numDigits.num1);
        const number2 = generateRandomNumber(numDigits.num2);

        const questionText = `${number1} % ${number2}`;
        const answer = number1 % number2;
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `modLevel${taskLevel}`
        });
    }
    return questions;
}

function generateSquareRootQuestions(numQuestions, taskLevel) {
    const questions = [];
    const accuracies = {
        1: 0,
        2: 2,
        3: 5,
        4: 8,
        5: 12
    };
    const accuracy = accuracies[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        const number = generateRandomNumber(6);
        const questionText = `√${number}`;
        const answer = parseFloat(Math.sqrt(number).toFixed(accuracy));
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `squareRootLevel${taskLevel}`,
            subCategory: 'squareRoots',  // Add this line
            taskLevel: taskLevel 
        });
    }
    return questions;
}

function generateNthRootQuestions(numQuestions, taskLevel) {
    const questions = [];
    const accuracies = {
        1: 0,
        2: 1,
        3: 3,
        4: 6,
        5: 10
    };
    const accuracy = accuracies[taskLevel];

    const generateRoot = () => {
        let cumulativeProbability = 0;
        const randomValue = Math.random();
        let root = 3;

        for (let y = 3; y <= 64; y++) {
            cumulativeProbability += 1 / Math.pow(2, y - 2);
            if (randomValue <= cumulativeProbability) {
                root = y;
                break;
            }
        }

        return root;
    };

    for (let i = 0; i < numQuestions; i++) {
        const root = generateRoot();
        const number = generateRandomNumber(6);
        const questionText = `${number}^(1/${root})`;
        const answer = parseFloat(Math.pow(number, 1 / root).toFixed(accuracy));
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `nthRootLevel${taskLevel}`,
            subCategory: 'nthRoots',  // Add this line
            taskLevel: taskLevel 
        });
    }
    return questions;
}

function generateFactorizationQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: 3,
        2: 4,
        3: 5,
        4: 6,
        5: 8
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        const number = generateRandomNumber(numDigits);
        const questionText = `Factorize ${number}`;
        const answer = primeFactorization(number).join(' ');
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `factorizationLevel${taskLevel}`,
            subCategory: 'factorization'
        });
    }
    return questions;
}

function primeFactorization(n) {
    const factors = [];
    let divisor = 2;

    while (n >= 2) {
        if (n % divisor === 0) {
            factors.push(divisor);
            n = n / divisor;
        } else {
            divisor++;
        }
    }
    return factors;
}

function generateSumOfSquaresQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: 3,
        2: 4,
        3: 6,
        4: 9,
        5: 13
    };
    const numDigits = digitLengths[taskLevel];

    for (let i = 0; i < numQuestions; i++) {
        const number = generateRandomNumber(numDigits);
        const questionText = `Express as the sum of four or less squares ${number}`;
        questions.push({
            text: questionText,
            answer: null,
            isFromList: false,
            category: `sumOfSquaresLevel${taskLevel}`,
            subCategory: 'sumOfSquares'
        });
    }
    return questions;
}

function findSumOfSquares(n) {
    const max = Math.floor(Math.sqrt(n));
    for (let a = 0; a <= max; a++) {
        const a2 = a * a;
        for (let b = a; b <= max; b++) {
            const b2 = b * b;
            for (let c = b; c <= max; c++) {
                const c2 = c * c;
                const d2 = n - a2 - b2 - c2;
                const d = Math.floor(Math.sqrt(d2));
                if (d >= c && d2 === d * d) {
                    return [a, b, c, d];
                }
            }
        }
    }
    return [];
}

function generateDecimalRootsQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: 3,
        2: 3,
        3: 6,
        4: 6,
        5: 6
    };
    const accuracies = {
        1: 0,
        2: 1,
        3: 1,
        4: 2,
        5: 3
    };
    const decimalPlaces = {
        1: 1,
        2: 3,
        3: 3,
        4: 3,
        5: 3
    };

    for (let i = 0; i < numQuestions; i++) {
        const number = generateRandomNumber(digitLengths[taskLevel]);
        const y = getRandomFloat(0, 1, decimalPlaces[taskLevel]);
        const questionText = `${number}^${y}`;
        const answer = parseFloat(Math.pow(number, y).toFixed(accuracies[taskLevel]));
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `decimalRootsLevel${taskLevel}`,
            subCategory: 'decimalRoots',  // Add this line
            taskLevel: taskLevel 
        });
    }
    return questions;
}

function generateDecimalExponentsQuestions(numQuestions, taskLevel) {
    const questions = [];
    const digitLengths = {
        1: 1,
        2: 1,
        3: 2,
        4: 2,
        5: 2
    };
    const decimalPlaces = {
        1: 1,
        2: 2,
        3: 3,
        4: 4,
        5: 5
    };

    for (let i = 0; i < numQuestions; i++) {
        const number = generateRandomNumber(digitLengths[taskLevel]);
        const y = getRandomFloat(1, 5, decimalPlaces[taskLevel]);
        const questionText = `${number}^${y}`;
        const answer = parseFloat(Math.pow(number, y).toFixed(0));
        questions.push({
            text: questionText,
            answer: answer,
            isFromList: false,
            category: `decimalExponentsLevel${taskLevel}`
        });
    }
    return questions;
}

function preselectNextBlitzCategories(roomName) {
    const game = games[roomName];
    if (!game) return;

    delete game.blitzFormatsChosen;
    delete game.selectedBlitzStandardCategory;
    delete game.selectedBlitzComplexCategory;
    delete game.blitzRandomFormatChosen;
    delete game.blitzRandomFormat;

    chooseFixedBlitzFormatsIfNeeded(roomName);
    chooseFixedBlitzRandomFormatIfNeeded(roomName);

    const { numOperations, range } = game.blitzRandomFormat;
    const [min, max] = range;
    const rangeLabel = max <= 9 ? '1to9' : max <= 99 ? '1to99' : '1to999';
    const sizeLabel = numOperations <= 4 ? 'small' : numOperations <= 7 ? 'medium' : 'large';
    const randomCategoryLabel = `blitzRandom_${rangeLabel}_${sizeLabel}`;

    game.statCategories = [
        game.selectedBlitzStandardCategory?.key || 'Standard',
        game.selectedBlitzComplexCategory?.key || 'Complex',
        randomCategoryLabel
    ];

    logWithTimestamp(`[Intermission Triggered] New Categories: ${game.statCategories.join(', ')}`);
    io.to(roomName).emit('blitzCategories', game.statCategories);
}

function generateQuestionsForRoom(mode, numQuestions, customFormatQuestionPercentage, roomName) {
    logWithTimestamp(`[generateQuestionsForRoom] BEGIN for room: ${roomName}`);
    const game = games[roomName];
    
    let questions = [];
    let listQuestionPercentage = customFormatQuestionPercentage;
    const isBlitzMode = ['blitzRegularSeason', 'blitzPlayoffs', 'blitzFinals'].includes(mode);
    if (isBlitzMode) listQuestionPercentage = 2 / 3;

    const listQuestionsCount = Math.floor(numQuestions * listQuestionPercentage);
    const difficulty = determineDifficulty(mode);

    if (isBlitzMode) {
        chooseFixedBlitzFormatsIfNeeded(roomName);
        chooseFixedBlitzRandomFormatIfNeeded(roomName);
        if (!game.selectedBlitzComplexCategory || !Array.isArray(game.selectedBlitzComplexCategory.formats)) {
            logWithTimestamp(`[generateQuestionsForRoom] ERROR: selectedBlitzComplexCategory invalid or missing formats. Value: ${JSON.stringify(game.selectedBlitzComplexCategory)}`);
        }        
        const half = Math.floor(listQuestionsCount / 2);

        const { numOperations, range } = game.blitzRandomFormat;
        // Compute random category label based on format
        const [min, max] = range;
        let rangeLabel = max <= 9 ? '1to9' : max <= 99 ? '1to99' : '1to999';
        let sizeLabel = numOperations <= 4 ? 'small' : numOperations <= 7 ? 'medium' : 'large';
        const randomCategoryLabel = `blitzRandom_${rangeLabel}_${sizeLabel}`;

        game.statCategories = [
            game.selectedBlitzStandardCategory?.key || 'Standard',
            game.selectedBlitzComplexCategory?.key || 'Complex',
            randomCategoryLabel
        ];
        logWithTimestamp(`[Blitz Categories Assigned] ${game.statCategories.join(', ')}`);


        const standardQuestions = [];
        for (let i = 0; i < half; i++) {
            const formatObj = getRandomFormatFromCategory(
                game.selectedBlitzStandardCategory.formats,
                game.selectedBlitzStandardCategory.key
            );
            const question = getRandomQuestionFromFormat(formatObj);
            if (question) standardQuestions.push(question);
        }

        const complexQuestions = [];
        const isSpecial = game.selectedBlitzComplexCategory?.isSpecial;
        for (let i = half; i < listQuestionsCount; i++) {
            let question;
            if (isSpecial) {
                question = game.selectedBlitzComplexCategory.generateQuestion();
if (question && game.selectedBlitzComplexCategory.key) {
    question.key = game.selectedBlitzComplexCategory.key;
}
            } else {
                if (!game.selectedBlitzComplexCategory?.formats || !Array.isArray(game.selectedBlitzComplexCategory.formats)) {
                    logWithTimestamp(`[generateQuestionsForRoom] ERROR: selectedBlitzComplexCategory is malformed: ${JSON.stringify(game.selectedBlitzComplexCategory)}`);
                }
                if (!game.selectedBlitzComplexCategory?.formats || !Array.isArray(game.selectedBlitzComplexCategory.formats)) {
                    logWithTimestamp(`[generateQuestionsForRoom] ERROR: No valid formats found for complex category '${game.selectedBlitzComplexCategory?.key}' — value: ${JSON.stringify(game.selectedBlitzComplexCategory)}`);
                }                
                const formatObj = getRandomFormatFromCategory(
                    game.selectedBlitzComplexCategory.formats,
                    game.selectedBlitzComplexCategory.key
                );
                question = getRandomQuestionFromFormat(formatObj);
            }
            if (question) complexQuestions.push(question);
        }

        const randomQuestions = [];
        for (let i = listQuestionsCount; i < numQuestions; i++) {
            randomQuestions.push(generateRandomQuestion(difficulty, numOperations, range, game.blitzRandomFormat));
        }

        // Interleave in the order: random, standard, complex
        const interleaved = [];
        let i = 0;
        while (randomQuestions.length > i || standardQuestions.length > i || complexQuestions.length > i) {
            if (randomQuestions[i]) interleaved.push(randomQuestions[i]);
            if (standardQuestions[i]) interleaved.push(standardQuestions[i]);
            if (complexQuestions[i]) interleaved.push(complexQuestions[i]);
            i++;
        }

        questions = interleaved;
    } else {
        for (let i = 0; i < listQuestionsCount; i++) {
            if (Math.random() < 0.12) {
                const specialType = Math.floor(Math.random() * 3);
                if (specialType === 0) {
                    questions.push(generateFactorizationListQuestion(difficulty));
                } else if (specialType === 1) {
                    questions.push(generateSumOfSquaresListQuestion(difficulty));
                } else {
                    questions.push(generateSystemOfEquationsQuestion(difficulty));
                }
            } else {
                questions.push(getRandomQuestionFromList(difficulty));
        }
    }

    for (let i = listQuestionsCount; i < numQuestions; i++) {
        questions.push(generateRandomQuestion(difficulty));
    }
}

if (!isBlitzMode) {
    questions = shuffleArray(questions);
}
logWithTimestamp(`Generated ${questions.length} questions for room ${roomName} in ${mode} mode`);
return questions;
}

function getRandomQuestionFromFormat(formatObj) {
    const MAX_VALUE = Math.pow(2, 53);
    let displayQuestion = formatObj.format;
    let calculationQuestion = displayQuestion.replace(/\^/g, '**');

    for (const variable in formatObj.ranges) {
        const value = getRandomInt(formatObj.ranges[variable][0], formatObj.ranges[variable][1]);
        const regex = new RegExp(variable, 'g');
        displayQuestion = displayQuestion.replace(regex, value);
        calculationQuestion = calculationQuestion.replace(regex, value);
    }

    displayQuestion = displayQuestion.replace(/\*/g, '×');
    let answer;
    try {
        answer = eval(calculationQuestion);
    } catch {
        return null;
    }

    if (!isFinite(answer) || Math.abs(answer) >= MAX_VALUE) return null;
    const category = formatObj._categoryKey || 'listQuestions';
    return { text: displayQuestion, answer, isFromList: true, category };

}

function getRandomFormatFromCategory(categoryArray, categoryKey = 'unknown') {
    if (!Array.isArray(categoryArray) || categoryArray.length === 0) {
        logWithTimestamp(`[getRandomFormatFromCategory] ERROR: Invalid or empty format array for category '${categoryKey}'`);
        return { format: 'Invalid format', answer: '', _categoryKey: categoryKey };
    }
    const randomIndex = Math.floor(Math.random() * categoryArray.length);
    const selectedFormat = categoryArray[randomIndex];
    return { ...selectedFormat, _categoryKey: categoryKey }; // preserve category label
}

function getRandomCategoryByDifficulty(sourceObject, difficulty) {
    const matchingKeys = Object.keys(sourceObject).filter(key => key.toLowerCase().endsWith(difficulty.toLowerCase()));
    const randomKey = matchingKeys[Math.floor(Math.random() * matchingKeys.length)];
    return { key: randomKey, formats: sourceObject[randomKey] };
}

function getBlitzFormatsByDifficulty(source, difficulty) {
    const suffix = difficulty.charAt(0).toUpperCase() + difficulty.slice(1); // e.g. 'Easy'
    const matchingKeys = Object.keys(source).filter(key => key.endsWith(suffix));
    
    // Combine all formats from matching keys
    return matchingKeys.flatMap(key => source[key]);
}

function getRandomQuestionFromListWithSource(listSource, difficulty) {
    const filteredList = listSource[difficulty] || [];
    if (filteredList.length === 0) return { question: 'No available questions', answer: '' };

    const randomIndex = Math.floor(Math.random() * filteredList.length);
    return filteredList[randomIndex];
}

function weightedRandomChoice(weightedItems) {
    const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const item of weightedItems) {
        rand -= item.weight;
        if (rand <= 0) return item.key;
    }
    return weightedItems[weightedItems.length - 1].key;
}

function chooseFixedBlitzFormatsIfNeeded(roomName, forceStandard = false, forceComplex = false) {
    const game = games[roomName];
    if (!game) return;

    const difficulty = determineDifficulty(game.gameSettings.selectedMode);

    if (forceStandard || !game.selectedBlitzStandardCategory) {
        const selectedStandardCategory = getRandomCategoryByDifficulty(questionFormatsBlitzStandard, difficulty);
        game.selectedBlitzStandardCategory = selectedStandardCategory;
    }
    if (
        forceComplex || 
        !game.selectedBlitzComplexCategory || 
        Object.keys(game.selectedBlitzComplexCategory).length === 0
      ) {      
        const complexWeights = [
            { key: 'AdditionMultiplication', weight: 1 },
            { key: 'AdditionRoots', weight: 1 },
            { key: 'AdditionDivision', weight: 1 },
            { key: 'MultiplicationRoots', weight: 1 },
            { key: 'MultiplicationDivision', weight: 1 },
            { key: 'RootsDivision', weight: 1 },
            { key: 'ABC', weight: 1 },
            { key: 'Mod', weight: 2 },
            { key: 'CubesSquares', weight: 2 },
            { key: 'CubeRoots', weight: 2 },
            { key: '4thRoots', weight: 1 },
            { key: '5thRoots', weight: 1 },
            { key: '6thRoots', weight: 1 },
            { key: '7thRoots', weight: 1 },
            { key: '8thRoots', weight: 1 },
            { key: 'FractionsAddition', weight: 2 },
            { key: 'FractionsMultiplication', weight: 2 },
            { key: 'Exponents', weight: 2 },
            { key: 'DecimalExponents', weight: 2 },
            { key: 'DecimalRoots', weight: 2 },
            { key: 'IrregularRoots', weight: 2 },
            { key: 'IrregularExponents', weight: 2 },
            { key: '2004MCWC', weight: 1 },
            { key: '2006MCWC', weight: 1 },
            { key: '2008MCWC', weight: 1 },
            { key: '2010MCWC', weight: 1 },
            { key: '2012MCWC', weight: 1 },
            { key: '2014MCWC', weight: 1 },
            { key: '2016MCWC', weight: 1 },
            { key: '2018MCWC', weight: 1 },
            { key: '2022MCWC', weight: 1 },
            { key: '2024MCWC', weight: 1 },
            { key: 'SumOfSquares', weight: 4 },
            { key: 'Factorization', weight: 4 },
            { key: 'SystemOfEquations', weight: 4 },
        ];

        const selectedKey = weightedRandomChoice(complexWeights);

        const isSpecial = ['SumOfSquares', 'Factorization', 'SystemOfEquations'].includes(selectedKey);

        if (isSpecial) {
            logWithTimestamp(`[BlitzFormat] Special complex format selected: ${selectedKey}`);
            game.selectedBlitzComplexCategory = {
                key: selectedKey,
                isSpecial: true,
                generateQuestion: () => {
                    switch (selectedKey) {
                        case 'SumOfSquares': return generateSumOfSquaresListQuestion(difficulty);
                        case 'Factorization': return generateFactorizationListQuestion(difficulty);
                        case 'SystemOfEquations': return generateSystemOfEquationsQuestion(difficulty);
                        default: return null;
                    }
                }
            };
        } else {
            const targetKey = 'blitz' + selectedKey + difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
            const found = Array.isArray(questionFormatsBlitzComplex)
                ? questionFormatsBlitzComplex.find(fmt => fmt.key === targetKey)
                : undefined;

            if (found) {
                game.selectedBlitzComplexCategory = found;
            } else {
                logWithTimestamp(`[BlitzFormat] WARNING: Format key '${targetKey}' not found in questionFormatsBlitzComplex`);
                game.selectedBlitzComplexCategory = {
                    key: targetKey,
                    formats: [],
                    isFallback: true
                };
            }
        }
    }

    if (!game.blitzFormatsChosen || forceStandard || forceComplex) {
        game.blitzFormatsChosen = true;
    }
}

function chooseFixedBlitzRandomFormatIfNeeded(roomName, force = false) {
    const game = games[roomName];
    if (!game) return;

    if (!game.blitzRandomFormatChosen || force) {
        const numOperations = Math.floor(Math.random() * 9) + 2; // 2–10 inclusive
        const mode = game.gameSettings.selectedMode;

        let range;
        const r = Math.random();

        if (mode === 'blitzRegularSeason') {
            // 50% 1–9, 50% 1–99
            range = r < 0.5 ? [1, 9] : [1, 99];
        } else if (mode === 'blitzPlayoffs') {
            // ~33% 1–9, ~33% 1–99, ~33% 1–999
            if (r < 1 / 3) {
                range = [1, 9];
            } else if (r < 2 / 3) {
                range = [1, 99];
            } else {
                range = [1, 999];
            }
        } else if (mode === 'blitzFinals') {
            // 50% 1–99, 50% 1–999
            range = r < 0.5 ? [1, 99] : [1, 999];
        } else {
            // fallback (shouldn't happen)
            range = [1, 99];
        }

        game.blitzRandomFormat = {
            numOperations,
            range
        };
        game.blitzRandomFormatChosen = true;
    }
}

function determineDifficulty(mode) {
    switch (mode) {
        case 'qualification':
            return 'easy';
        case 'regularSeason':
            return Math.random() < 0.75 ? 'easy' : 'medium';
        case 'playoffs':
            let playoffsRandom = Math.random();
            if (playoffsRandom < 0.5) {
                return 'easy';
            } else if (playoffsRandom < 0.75) {
                return 'medium';
            } else {
                return 'difficult';
            }
        case 'finals':
            let finalsRandom = Math.random();
            if (finalsRandom < 0.25) {
                return 'easy';
            } else if (finalsRandom < 0.75) {
                return 'medium';
            } else {
                return 'difficult';
            }
        default:
            return 'easy';
    }
}

function generateQuestion(mode, customFormatQuestionPercentage) {
    const difficulty = determineDifficulty(mode);

    if (Math.random() < customFormatQuestionPercentage) {
        let question = getRandomQuestionFromList(difficulty);
        if (question) {
            question.category = "listQuestions";
            return question;
        } else {
            return generateRandomQuestion(difficulty);
        }
    } else {
        return generateRandomQuestion(difficulty);
    }
}

function getRandomQuestionFromList(difficulty) {
    const MAX_VALUE = Math.pow(2, 53);
    let questionFormat, displayQuestion, calculationQuestion, answer;

    do {
        if (difficulty === 'easy') {
            questionFormat = questionFormats.easy[Math.floor(Math.random() * questionFormats.easy.length)];
        } else if (difficulty === 'medium') {
            questionFormat = questionFormats.medium[Math.floor(Math.random() * questionFormats.medium.length)];
        } else if (difficulty === 'difficult') {
            questionFormat = questionFormats.difficult[Math.floor(Math.random() * questionFormats.difficult.length)];
        }

        if (!questionFormat) {
            return null;
        }

        displayQuestion = questionFormat.format;
        calculationQuestion = displayQuestion.replace(/\^/g, '**');

        for (const variable in questionFormat.ranges) {
            const value = getRandomInt(questionFormat.ranges[variable][0], questionFormat.ranges[variable][1]);
            displayQuestion = displayQuestion.replace(new RegExp(variable, 'g'), value);
            calculationQuestion = calculationQuestion.replace(new RegExp(variable, 'g'), value);
        }

        displayQuestion = displayQuestion.replace(/\*/g, '×');

        try {
            answer = eval(calculationQuestion);
        } catch (error) {
            return { text: "Error generating question", answer: 0, category: 'error' };
        }
    } while (!isFinite(answer) || Math.abs(answer) >= MAX_VALUE);

    return { text: displayQuestion, answer, isFromList: true, category: 'listQuestions' };
}

function generateRandomQuestion(difficulty, overrideNumOperations = null, overrideRange = null, blitzRandomFormat = null) {
    let answer, question, calculationQuestion;
    const MAX_VALUE = Math.pow(2, 53);
    let numOperations = overrideNumOperations !== null ? overrideNumOperations : getRandomInt(2, 10);


    do {
        let divisionUsed = false;
        let divisionIndex = null;
        let questionParts = [];
        let calculationParts = [];
        let openParenthesis = false;
        let currentSum = 0;
        let range = overrideRange !== null ? overrideRange : (difficulty === 'easy' ? [1, 9] : difficulty === 'medium' ? [1, 99] : [1, 999]);
    

        let operationChoices = ['+', '+', '+', '+', '+', '-', '-', '-', '-', '-', '*', '*', '*', '*', '*', '/', '/', '/'];

        for (let i = 0; i < numOperations; i++) {
            let operationIndex = getRandomInt(0, operationChoices.length - 1);
            let operation = operationChoices[operationIndex];

            if (operation === '/') {
                if (!divisionUsed) {
                    divisionUsed = true;
                    divisionIndex = questionParts.length;

                    operationChoices = operationChoices.filter(op => op !== '/');
                } else {
                    operationIndex = getRandomInt(0, operationChoices.length - 1);
                    operation = operationChoices[operationIndex];
                }
            }

            let value;
            if (operation === '+' || operation === '-') {
                if (!openParenthesis) {
                    questionParts.push('(');
                    calculationParts.push('(');
                    openParenthesis = true;
                    currentSum = 0;
                }

                do {
                    value = getRandomInt(...range);
                    if (operation === '-') value = -value;
                } while (currentSum + value === 0 || (i === numOperations - 1 && currentSum + value - getRandomInt(...range) === 0));

                currentSum += value;
                if (value < 0) {
                    operation = '-';
                    value = -value;
                } else {
                    operation = '+';
                }
            } else {
                value = getRandomInt(...range);
            }

            questionParts.push(value);
            calculationParts.push(value);

            if ((operation === '*' || operation === '/') && openParenthesis) {
                questionParts.push(')');
                calculationParts.push(')');
                openParenthesis = false;
            }

            if (operation === '/') {
                divisionUsed = true;
                divisionIndex = questionParts.length;
            }

            questionParts.push(operation);
            calculationParts.push(operation);
        }

        let lastValue = getRandomInt(...range);
        questionParts.push(lastValue);
        calculationParts.push(lastValue);

        if (openParenthesis) {
            questionParts.push(')');
            calculationParts.push(')');
        }

        if (divisionUsed) {
            let leftSide = questionParts.slice(0, divisionIndex);
            let rightSide = questionParts.slice(divisionIndex + 1);
            question = ['('].concat(leftSide).concat(')').concat(questionParts[divisionIndex]).concat('(').concat(rightSide).concat(')').join(' ').replace(/\*/g, '×').trim();
            calculationQuestion = ['('].concat(calculationParts.slice(0, divisionIndex)).concat(')').concat(calculationParts[divisionIndex]).concat('(').concat(calculationParts.slice(divisionIndex + 1)).concat(')').join('').trim();
        } else {
            question = questionParts.join(' ').replace(/\*/g, '×').trim();
            calculationQuestion = calculationParts.join('').trim();
        }

        try {
            answer = eval(calculationQuestion);
        } catch (e) {
            answer = Infinity;
        }

        if (!isFinite(answer)) {
            // Handle infinity or undefined values
        }

        if (Math.abs(answer) >= MAX_VALUE) {
            logWithTimestamp(`Regenerating question due to answer exceeding ${MAX_VALUE}: ${answer}`);
        }
        
    } while (!isFinite(answer) || Math.abs(answer) >= MAX_VALUE);

    let category;

    if (blitzRandomFormat) {
        const [min, max] = blitzRandomFormat.range;
    
        let rangeLabel = '';
        if (max <= 9) rangeLabel = '1to9';
        else if (max <= 99) rangeLabel = '1to99';
        else rangeLabel = '1to999';
    
        let sizeLabel;
        if (numOperations >= 2 && numOperations <= 4) sizeLabel = 'small';
        else if (numOperations >= 5 && numOperations <= 7) sizeLabel = 'medium';
        else sizeLabel = 'large';
    
        category = `blitzRandom_${rangeLabel}_${sizeLabel}`;
    } else {
        if (numOperations >= 2 && numOperations <= 4) category = "smallRandomQuestions";
        else if (numOperations >= 5 && numOperations <= 7) category = "mediumRandomQuestions";
        else category = "largeRandomQuestions";
    }

    return {
        text: question,
        answer: answer,
        isFromList: false,
        category: category
    };
}

function generateFactorizationListQuestion(difficulty) {
    let numDigits;
    switch (difficulty) {
        case 'easy':
            numDigits = Math.random() < 0.5 ? 4 : 5;
            break;
        case 'medium':
            numDigits = Math.random() < 0.5 ? 6 : 7;
            break;
        case 'difficult':
            numDigits = Math.random() < 0.5 ? 8 : 9;
            break;
        default:
            numDigits = 5;
            break;
    }

    const number = generateRandomNumber(numDigits);
    const questionText = `Factorize ${number}`;
    const answer = primeFactorization(number).join(' ');

    return {
        text: questionText,
        answer: answer,
        isFromList: true,
        type: 'list',                             // ← Add this
        category: 'listQuestions', 
        subCategory: 'factorization' // New subCategory property
    };
}

function generateSumOfSquaresListQuestion(difficulty) {
    let numDigits;
    switch (difficulty) {
        case 'easy':
            numDigits = Math.random() < 0.5 ? 4 : 5;
            break;
        case 'medium':
            numDigits = Math.random() < 0.5 ? 6 : 7;
            break;
        case 'difficult':
            numDigits = Math.random() < 0.5 ? 8 : 9;
            break;
        default:
            numDigits = 5;
            break;
    }

    const number = generateRandomNumber(numDigits);
    const questionText = `Express as the sum of four or less squares ${number}`;
    const answer = findSumOfSquares(number).join(' ');

    return {
        text: questionText,
        answer: answer,
        isFromList: true,
        type: 'list',                             // ← Add this
        category: 'listQuestions', 
        subCategory: 'sumOfSquares' // New subCategory property
    };
}
function generateRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomValue(numDigits) {
    numDigits = Math.max(1, numDigits);
    const min = Math.pow(10, numDigits - 1);
    const max = Math.pow(10, numDigits) - 1;
    return generateRandomInt(min, max);
}

function generateSystemOfEquationsQuestion(difficulty) {
    let numEquations, numVariables;
    switch (difficulty) {
        case 'easy':
            numEquations = 2;
            numVariables = 2;
            break;
        case 'medium':
            numEquations = 3;
            numVariables = 3;
            break;
        case 'difficult':
            numEquations = 4;
            numVariables = 4;
            break;
        default:
            numEquations = 2;
            numVariables = 2;
            break;
    }

    // Generate random integer solutions
    const solutions = Array(numVariables).fill(0).map(() => generateRandomInt(1, 30)); 

    // Generate coefficients and constants based on the solutions
    const coefficients = [];
    const constants = [];
    const variables = ['x', 'y', 'z', 'w'];

    for (let i = 0; i < numEquations; i++) {
        coefficients.push([]);
        let constant = 0;
        for (let j = 0; j < numVariables; j++) {
            const coeff = generateRandomValue(1 + Math.floor(Math.random() * 3)); // Adjusting range for more diversity
            coefficients[i].push(coeff);
            constant += coeff * solutions[j];
        }
        constants.push(constant);
    }

    // Format the question to be split per equation on the client side
    let questionText = '';
    for (let i = 0; i < numEquations; i++) {
        let equation = '';
        for (let j = 0; j < numVariables; j++) {
            if (j > 0 && coefficients[i][j] >= 0) equation += ' + ';
            equation += `${coefficients[i][j]}${variables[j]}`;
        }
        equation += ` = ${constants[i]}`;
        questionText += `${equation}\n`;
    }

    // Join the solution as the correct answer
    const answer = solutions.join(' ');

    return {
        text: questionText.trim(),  // Trim to remove any trailing newline
        answer: answer,
        isFromList: true,
        type: 'list',                             // ← Add this
        category: 'listQuestions', 
        subCategory: 'systemsOfEquations'
    };
}

function solveSystem(coefficients, constants) {
    const numVariables = coefficients[0].length;
    const augmentedMatrix = [];

    // Create the augmented matrix [A|b]
    for (let i = 0; i < coefficients.length; i++) {
        augmentedMatrix[i] = [...coefficients[i], constants[i]];
    }

    // Perform Gaussian elimination
    for (let i = 0; i < numVariables; i++) {
        // Make the diagonal contain all 1s
        let maxRow = i;
        for (let k = i + 1; k < numVariables; k++) {
            if (Math.abs(augmentedMatrix[k][i]) > Math.abs(augmentedMatrix[maxRow][i])) {
                maxRow = k;
            }
        }

        // Swap the row with the maximum element with the current row
        [augmentedMatrix[i], augmentedMatrix[maxRow]] = [augmentedMatrix[maxRow], augmentedMatrix[i]];

        // Make the pivot equal to 1 by dividing the whole row
        const pivot = augmentedMatrix[i][i];
        for (let j = i; j < numVariables + 1; j++) {
            augmentedMatrix[i][j] /= pivot;
        }

        // Make all rows below this one 0 in the current column
        for (let k = i + 1; k < numVariables; k++) {
            const factor = augmentedMatrix[k][i];
            for (let j = i; j < numVariables + 1; j++) {
                augmentedMatrix[k][j] -= factor * augmentedMatrix[i][j];
            }
        }
    }

    // Back substitution to solve for variables
    const solution = Array(numVariables).fill(0);
    for (let i = numVariables - 1; i >= 0; i--) {
        solution[i] = augmentedMatrix[i][numVariables];
        for (let j = i + 1; j < numVariables; j++) {
            solution[i] -= augmentedMatrix[i][j] * solution[j];
        }
        solution[i] = Math.round(solution[i]); // Rounding to ensure integer solutions
    }

    return solution;
}


function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function evaluateAnswer(question, submittedAnswer) {
    if (!question || !question.category) {
        return false;
    }

    const correctAnswer = question.answer ? question.answer.toString().trim() : null;
    const submittedAnswerTrimmed = submittedAnswer.trim();

    // Check if the question has a subCategory for special cases
    if (question.subCategory) {
        
        if (question.subCategory === 'factorization') {
            const submittedFactors = submittedAnswerTrimmed.split(/\s+/).map(Number).sort((a, b) => a - b);
            const correctFactors = correctAnswer.split(/\s+/).map(Number).sort((a, b) => a - b);

            logWithTimestamp('Submitted factors:', submittedFactors);
            logWithTimestamp('Correct factors:', correctFactors);

            return JSON.stringify(submittedFactors) === JSON.stringify(correctFactors);
        } else if (question.subCategory === 'sumOfSquares') {

            const submittedNumbers = submittedAnswerTrimmed.split(/\s+/).map(Number);
            if (submittedNumbers.length > 4) {
                logWithTimestamp(`Answer has more than 4 integers: ${submittedNumbers.length}`);
                return false; // Automatically incorrect if more than 4 integers
            }
            // Handle sum of squares without pre-computed answers
            const submittedSquaresSum = submittedAnswerTrimmed.split(/\s+/).map(Number).map(n => n * n).reduce((acc, num) => acc + num, 0);
            const correctSquaresSum = parseInt(question.text.match(/\d+/)[0], 10); // Extract target sum from the question text

            logWithTimestamp('Submitted sum of squares:', submittedSquaresSum);
            logWithTimestamp('Expected sum of squares:', correctSquaresSum);

            return submittedSquaresSum === correctSquaresSum;
        } else if (question.subCategory === 'systemsOfEquations') {
            const submittedSolution = submittedAnswerTrimmed.split(/\s+/).map(Number);
            const correctSolution = correctAnswer.split(/\s+/).map(Number);

            logWithTimestamp('Submitted solution:', submittedSolution);
            logWithTimestamp('Correct solution:', correctSolution);

            return JSON.stringify(submittedSolution) === JSON.stringify(correctSolution);
        } else {
            logWithTimestamp(`[Warning] Unknown subCategory '${question.subCategory}' — falling back to numerical evaluation.`);
            // fallthrough to numerical
        }
    }
    // Default numerical evaluation
    const isCorrect = evaluateNumericalAnswer(submittedAnswerTrimmed, correctAnswer, question);
    logWithTimestamp(`[EvalResult] Default evaluation — submitted: '${submittedAnswerTrimmed}', expected: '${correctAnswer}', result: ${isCorrect}`);
    return isCorrect;    
}

function evaluateNumericalAnswer(submittedAnswer, correctAnswer, question) {
    // Sanitize the submitted answer
    submittedAnswer = submittedAnswer.replace(',', '.');

    // Initialize tolerance
    let tolerance;
    let isTaskSpecific = false;

    // Add additional safety checks for taskLevel and subCategory
    if (question && question.subCategory && question.taskLevel) {
        const accuracies = {
            squareRoots: { 1: 0, 2: 2, 3: 5, 4: 8, 5: 12 },  // Level 3 should have 3 decimal places
            nthRoots: { 1: 0, 2: 1, 3: 3, 4: 6, 5: 10 },
            decimalRoots: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 3 }
        };

        const subCategory = question.subCategory || 'unknown';
        const taskLevel = parseInt(question.taskLevel, 10); // Ensure taskLevel is treated as a number

        if (['squareRoots', 'nthRoots', 'decimalRoots'].includes(subCategory) && accuracies[subCategory]) {
            const requiredAccuracy = accuracies[subCategory][taskLevel];
            
            if (requiredAccuracy !== undefined) {
                tolerance = Math.pow(10, -requiredAccuracy); // Set tolerance based on accuracy level
                isTaskSpecific = true;
            } else {
                console.error(`No accuracy mapping found for ${subCategory}, level ${taskLevel}`);
            }
        } else {
            console.error(`SubCategory ${subCategory} not supported for task-specific evaluation.`);
        }
    } else {
        // Safely handle cases where taskLevel or subCategory is undefined
        const safeTaskLevel = question ? question.taskLevel : 'undefined';
        const safeSubCategory = question ? question.subCategory : 'undefined';
    }

    // Fallback: Use the existing tolerance logic if no task-specific tolerance was set
    if (!isTaskSpecific) {
        if (correctAnswer >= -1 && correctAnswer <= 1) {
            if (correctAnswer !== 0) {
                const magnitude = Math.floor(Math.log10(Math.abs(correctAnswer)));
                tolerance = 5 * Math.pow(10, magnitude - 2); // Two significant digits
            } else {
                tolerance = 0.01; // Special case for zero
            }
        } else if ((correctAnswer >= -10 && correctAnswer < -1) || (correctAnswer > 1 && correctAnswer <= 10)) {
            tolerance = 0.05;
        } else {
            tolerance = 0.5;
        }
    }

    // Evaluate the answer using the set tolerance
    const difference = Math.abs(Number(submittedAnswer) - correctAnswer);
    const isCorrect = difference <= tolerance;
    return isCorrect;
}


const questionSendTimes = {};
const questionTimes = {};

function logPlayerStats(playerName, roomName) {
    let statsMessage = `[Question Sent] Stats for ${playerName} in ${roomName}: `;
    const playerStats = games[roomName]?.playerStats?.[playerName];
    if (!playerStats) {
        console.warn(`[Warning] No stats found for ${playerName} in ${roomName}`);
        return;
    }

    const categories = Object.keys(playerStats);

    categories.forEach((category) => {
        const { correct, total, totalTime } = playerStats[category] || {};
        if (typeof total === 'number' && total > 0) {
            statsMessage += `${category}: Correct: ${correct}, Total: ${total}, Total Time: ${totalTime.toFixed(2)} seconds; `;
        }
    });

    logWithTimestamp(statsMessage);
}

function updatePlayerStats(roomName, playerName, questionIndex) {
    const game = games[roomName];
    if (!game || !game.questions || !game.questions[questionIndex]) return;

    const currentTime = Date.now();
    const sendTimeKey = `${roomName}_${playerName}_${questionIndex}`;
    const sendTime = questionSendTimes[sendTimeKey];
    const timeSpentRaw = sendTime ? (currentTime - sendTime) / 1000 : 0;
    const timeSpent = timeSpentRaw > 0 ? timeSpentRaw : 30.0;

    if (!sendTime) {
        console.warn(`Missing send time for ${sendTimeKey} — falling back to 30.0s`);
    }

    const question = game.questions[questionIndex];
    if (!question) {
        console.warn(`[Stats Skipped] No valid question for index ${questionIndex} (player: ${playerName})`);
        return;
    }

    const statsKey = getStatsKey(game, question);
    if (!statsKey || typeof statsKey !== 'string') {
        console.warn(`[Stats Skipped] Invalid statsKey for question`, question);
        return;
    }

    if (!game.playerStats[playerName]) {
        game.playerStats[playerName] = {};
    }
    if (!game.playerStats[playerName][statsKey]) {
        game.playerStats[playerName][statsKey] = { correct: 0, total: 0, totalTime: 0 };
    }

    if (!questionTimes[playerName]) {
        questionTimes[playerName] = [];
    }

    const existing = questionTimes[playerName][questionIndex];
    const wasCountedInTotal = existing?.wasCountedInTotal === true;
    const timeWasLow = existing && existing.time < 29.9;
    if (!existing) {
        // First time this question is being recorded
        game.playerStats[playerName][statsKey].totalTime += 30.0;
        game.playerStats[playerName][statsKey].total += 1;
    
        questionTimes[playerName][questionIndex] = {
            question: question.text,
            time: 30.0,
            skipped: true,
            submittedAnswer: null,
            correctAnswer: question.answer,
            isCorrect: false,
            wasCountedInTotal: true
        };
    
        logWithTimestamp(`[Stats Added] ${playerName} missed Q${questionIndex} → total +1, time +30.0s in ${statsKey}`);
    } else {
        let patched = false;
    
        if (!wasCountedInTotal) {
            game.playerStats[playerName][statsKey].total += 1;
            questionTimes[playerName][questionIndex].wasCountedInTotal = true;
            logWithTimestamp(`[Stats Total Fix] ${playerName} Q${questionIndex} was missing total → total +1 in ${statsKey}`);
            patched = true;
        }
    
        if (!existing.skipped) {
            // Forcefully mark as skipped and assign time if not already
            questionTimes[playerName][questionIndex].skipped = true;
    
            if (!existing.time || existing.time < 29.9) {
                const delta = 30.0 - (existing.time || 0);
                game.playerStats[playerName][statsKey].totalTime += delta;
                questionTimes[playerName][questionIndex].time = 30.0;
                logWithTimestamp(`[Stats Overwrite] ${playerName} partial Q${questionIndex} → added ${delta.toFixed(2)}s to reach 30.0s`);
                patched = true;
            }
        }
    
        if (!patched) {
            logWithTimestamp(`[Stats Warning] ${playerName} Q${questionIndex} skipped but no updates applied`);
        }
    }
        const finalStat = game.playerStats[playerName][statsKey];
        logWithTimestamp(`[DEBUG] Final stats for ${playerName} in ${statsKey} → Correct: ${finalStat.correct}, Total: ${finalStat.total}, Time: ${finalStat.totalTime.toFixed(2)}s`);

    logPlayerStats(playerName, roomName);
}

function sendQuestionToPlayer(roomName, playerName, questionIndex) {
    const game = games[roomName];
    logWithTimestamp(`[sendQuestionToPlayer] Called with player: ${playerName}, index: ${questionIndex}, intermissionActive: ${game?.intermissionActive}`);
    if (game.intermissionActive) {
        logWithTimestamp(`[Question Blocked] Intermission active. No question sent to ${playerName}`);
        return;
    }    
    if (game && questionIndex < game.questions.length) {
        const question = game.questions[questionIndex];
        const socketId = playerSockets[playerName];
        if (socketId) {
            const currentTime = Date.now();
            const currentSendTimeKey = `${roomName}_${playerName}_${questionIndex}`;
            questionSendTimes[currentSendTimeKey] = currentTime;
            if (!game.sendTimes) {
                game.sendTimes = {};
            }
            game.sendTimes[currentSendTimeKey] = currentTime;
            logWithTimestamp(`[sendQuestionToPlayer] Set send time key '${currentSendTimeKey}' = ${currentTime}`);
            io.to(socketId).emit('newQuestion', question);
        }
    }
}

function sendQuestionToRoom(roomName) {
    const game = games[roomName];
    if (!game || !game.questions || game.questions.length === 0) return;

    if (!game.sendTimes) {
        game.sendTimes = {};
    }

    for (const playerName in game.players) {
        // Initialize player index if missing
        if (!(playerName in game.playerQuestionIndices)) {
            game.playerQuestionIndices[playerName] = 0;
        }

        const questionIndex = game.playerQuestionIndices[playerName];
        const question = game.questions[questionIndex];

        if (!question) {
            logWithTimestamp(`No question available for player ${playerName} at index ${questionIndex}`);
            continue;
        }

        const playerSocketId = playerSockets[playerName];
        if (playerSocketId) {
            logWithTimestamp(`[sendQuestionToRoom] Sending question to ${playerName} (index ${questionIndex}) in room ${roomName}`);
            // ✅ Emit only the question (original behavior)
            io.to(playerSocketId).emit('newQuestion', question);

            const key = `${roomName}_${playerName}_${questionIndex}`;
            if (!questionSendTimes) global.questionSendTimes = {};  // Ensure global object exists
            questionSendTimes[key] = Date.now();

        }
    }
}

function checkGameOver(roomName) {
    logWithTimestamp(`[checkGameOver] Invoked for room: ${roomName}`);
    const game = games[roomName];
    if (!game) {
        console.warn(`[checkGameOver] No game found for room: ${roomName}`);
        return;
    }
    if (game.intermissionScheduled || game.intermissionActive) {
        logWithTimestamp(`[checkGameOver] Skipping — intermission already in progress for room: ${roomName}`);
        return;
    }

    const timeElapsed = (Date.now() - game.startTime) / 1000;
    logWithTimestamp(`[checkGameOver] Time elapsed: ${timeElapsed.toFixed(2)}s`);
    const scoreDifference = Math.abs(
        game.scores[Object.keys(game.scores)[0]] - game.scores[Object.keys(game.scores)[1]]
    );
    logWithTimestamp(`[checkGameOver] Score difference: ${scoreDifference}`);

    if (game.gameSettings) {
        const selectedMode = game.gameSettings.selectedMode;
        const isBlitz =
        selectedMode === 'blitzRegularSeason' ||
        selectedMode === 'blitzPlayoffs' ||
        selectedMode === 'blitzFinals';
    
    if (isBlitz && timeElapsed >= (
        selectedMode === 'blitzRegularSeason' ? 150 :
        selectedMode === 'blitzPlayoffs' ? 225 :
        300
    )) {
        logWithTimestamp(`[checkGameOver] Blitz time limit reached for ${selectedMode}`);
        // Blitz mini-match time limit reached
        if (!game.blitzMiniMatchCount) game.blitzMiniMatchCount = 0;
        if (!game.blitzMiniMatchWins) game.blitzMiniMatchWins = {};
    
        // Determine winner of the mini-match
        const [p1, p2] = Object.keys(game.players);
        const s1 = game.scores[p1] || 0;
        const s2 = game.scores[p2] || 0;

        logWithTimestamp(`[checkGameOver] Scores — ${p1}: ${s1}, ${p2}: ${s2}`);
    
        if (s1 !== s2) {
            const winner = s1 > s2 ? p1 : p2;
            if (!game.blitzMiniMatchWins[winner]) {
                game.blitzMiniMatchWins[winner] = 0;
            } else {
                logWithTimestamp(`[checkGameOver] Duplicate win count? Existing wins for ${winner}: ${game.blitzMiniMatchWins[winner]}`);
            }
            game.blitzMiniMatchWins[winner]++;
            logWithTimestamp(`[checkGameOver] Mini-match winner: ${winner}`);
            logWithTimestamp(`[checkGameOver] Updated blitzMiniMatchWins: ${JSON.stringify(game.blitzMiniMatchWins)}`);
        } else {
            logWithTimestamp(`[checkGameOver] Mini-match tied. No winner awarded.`);
        }

        if (!game.blitzMatchHistory) game.blitzMatchHistory = [];
        const matchSnapshot = {};
        matchSnapshot[p1] = s1;
        matchSnapshot[p2] = s2;
        game.blitzMatchHistory.push(matchSnapshot);
        logWithTimestamp(`[checkGameOver] Recorded mini-match scores: ${JSON.stringify(matchSnapshot)}`);
    
        game.blitzMiniMatchCount++;
    
        const winsP1 = game.blitzMiniMatchWins[p1] || 0;
        const winsP2 = game.blitzMiniMatchWins[p2] || 0;  
        const matchComplete = game.blitzMiniMatchCount >= 9 || winsP1 >= 5 || winsP2 >= 5;
    
        if (matchComplete) {
            logWithTimestamp(`[Blitz Match Complete] Total Mini-matches: ${game.blitzMiniMatchCount}`);
            logWithTimestamp(`[Blitz Match Complete] Final Wins — ${p1}: ${winsP1}, ${p2}: ${winsP2}`);
            setTimeout(() => {
                endGameInRoom(roomName);
            }, 100);
        } else if (!game.intermissionScheduled) {  // ✅ Guard: only one intermission at a time
            game.intermissionScheduled = true;     // ✅ Prevent duplicate intermissions
            game.intermissionActive = true;
            game.statCategories = null;

            logWithTimestamp(`[checkGameOver] Starting intermission. Assigning new categories...`);
            // ✅ Use preselection helper instead of generating dummy questions
            preselectNextBlitzCategories(roomName);

            let losingPlayer = null;
            if (s1 !== s2) {
            losingPlayer = s1 < s2 ? p1 : p2;
            }
            io.to(roomName).emit('startBlitzIntermission', { countdown: 30, losingPlayer });
            io.to(roomName).emit('intermissionStarted', { losingPlayer });

            if (game.blitzMatchHistory) {
                const players = Object.keys(game.players);
                io.to(roomName).emit('blitzIntermissionData', {
                    matchHistory: game.blitzMatchHistory,
                    players
                });
            }
            
            setTimeout(() => {
                game.intermissionActive = false; 
                game.intermissionScheduled = false;
                restartBlitzMiniMatch(roomName);
            }, 30000);
        }
        else {
            console.warn(`[checkGameOver] Intermission already scheduled — skipping duplicate setup.`);
        }

        return;
    }
        const shouldEnd =
            (selectedMode === 'blitzRegularSeason' && timeElapsed >= 150) ||
            (selectedMode === 'blitzPlayoffs' && timeElapsed >= 225) ||
            (selectedMode === 'blitzFinals' && timeElapsed >= 300) ||
            (selectedMode === 'playoffs' &&
                ((scoreDifference >= 50 && timeElapsed >= 900) ||
                 (scoreDifference >= 5 && timeElapsed >= 1800) ||
                 (scoreDifference >= 0 && timeElapsed >= 2700))) ||
            (selectedMode === 'finals' &&
                ((scoreDifference >= 50 && timeElapsed >= 1200) ||
                 (scoreDifference >= 5 && timeElapsed >= 2400) ||
                 (scoreDifference >= 0 && timeElapsed >= 3600))) ||
            ((selectedMode === 'qualification' || selectedMode === 'regularSeason') &&
                ((scoreDifference >= 50 && timeElapsed >= 600) ||
                 (scoreDifference >= 5 && timeElapsed >= 1200) ||
                 (scoreDifference >= 0 && timeElapsed >= 1800))) ||
            (!['blitzRegularSeason', 'blitzPlayoffs', 'blitzFinals', 'playoffs', 'finals', 'qualification', 'regularSeason'].includes(selectedMode) &&
                (timeElapsed >= 600 || scoreDifference >= 30));
            
        if (shouldEnd) {
            logWithTimestamp(`[Game Over Trigger] ${selectedMode} – Time: ${timeElapsed.toFixed(2)}s`);
            // Give a short delay to allow stats to finalize before ending the game
            setTimeout(() => {
                endGameInRoom(roomName);
            }, 100);
            return;
        }
    }

    // Fallback: end if all players exhausted all questions
    let gameOver = true;
    for (const playerName in game.players) {
        if (game.playerQuestionIndices[playerName] < game.questions.length) {
            gameOver = false;
            break;
        }
    }

    if (gameOver) {
        console.log(`Game over in room ${roomName}`);
        endGameInRoom(roomName);
    }
}

function restartBlitzMiniMatch(roomName) {
    const game = games[roomName];
    if (!game) return;

    // Reset only mini-match data — do not touch cumulative stats
    game.questions = [];
    game.playerQuestionIndices = {};
    game.scores = {};
    game.sendTimes = {};
    game.gameStarted = false;

    for (const playerName in game.players) {
        game.playerQuestionIndices[playerName] = 0;
        game.scores[playerName] = 0;

        if (questionTimes[playerName]) {
            questionTimes[playerName] = [];
        }
    }

    startGame(roomName, { skipCountdown: true });
    game.intermissionActive = false;
    const nextCategories = game.statCategories || [];
    logWithTimestamp(`[Next Mini-Match Categories] ${nextCategories.join(', ')}`);
}


function endGameInRoom(roomName) {
    const game = games[roomName];
    if (!game) {
        return;
    }

    const results = {
        players: [],
        winner: null,
    };

    let highestScore = -1;

    for (const playerName in game.scores) {
        const playerStats = {
            name: playerName,
            score: game.scores[playerName],
            stats: game.playerStats[playerName] || {},
            detailed: game.gameSettings?.isBlitz ? [] : questionTimes[playerName] || [],
        };

        const maxIndex = Math.max(
            ...Object.keys(game.sendTimes || {})
                .filter(k => k.startsWith(`${roomName}_${playerName}_`))
                .map(k => parseInt(k.split('_')[2], 10))
        );

        if (!game.gameSettings?.isBlitz) {
            for (let i = 0; i < game.questions.length; i++) {
                if (!playerStats.detailed[i]) {
                    const key = `${roomName}_${playerName}_${i}`;
                    const sendTime = game.sendTimes?.[key];
                    const timeTaken = sendTime ? (Date.now() - sendTime) / 1000 : 0;
        
                    playerStats.detailed[i] = {
                        question: game.questions[i]?.text || `Q${i + 1}`,
                        correctAnswer: game.questions[i]?.answer || null,
                        submittedAnswer: null,
                        time: timeTaken,
                        skipped: true,
                    };
                }
            }
            playerStats.detailed = playerStats.detailed.slice(0, maxIndex + 1);
        }
        
        results.players.push(playerStats);

        if (game.scores[playerName] > highestScore) {
            highestScore = game.scores[playerName];
            results.winner = playerName;
        }

        let statsMessage = '';
        const statsKeys = Object.keys(playerStats.stats);
        statsKeys.forEach((key) => {
            const { correct, total, totalTime } = playerStats.stats[key] || {};
            if (total > 0) {
                statsMessage += `Category (${key}): ${correct} correct out of ${total} questions, ${totalTime.toFixed(2)} seconds\n`;
            }
        });

        playerStats.detailed.forEach((detail, index) => {
            const skipStatus = detail.skipped ? "Skipped" : "";
            statsMessage += `Q${index + 1}: ${detail.question} - Time: ${detail.time.toFixed(2)}s ${skipStatus}\n`;

            if (detail.skipped || detail.submittedAnswer !== detail.correctAnswer || detail.correctAnswer === 0) {
                statsMessage += `   Correct Answer: ${detail.correctAnswer}\n`;
                if (!detail.skipped) {
                    statsMessage += `   Submitted Answer: ${detail.submittedAnswer}\n`;
                }
            }
        });

        logWithTimestamp(`[Player Stats] ${playerName} in Room ${roomName}:\n${statsMessage}`);
    }

    // Sort players to display the current player first
    results.players.sort((player) =>
        player.name === game.currentPlayerName ? -1 : 1
    );

    if (game.gameSettings?.isBlitz && Array.isArray(game.blitzMatchHistory)) {
        results.blitzMatchHistory = game.blitzMatchHistory;
    }

    // Create comparative stats if available
    results.comparative = [];

    if (!game.gameSettings?.isBlitz) {
        for (let i = 0; i < game.questions.length; i++) {
            const questionDetails = {
                questionNumber: i + 1,
                times: {},
            };
    
            let questionUsed = false;
    
            for (const playerName in game.players) {
                const time = questionTimes[playerName]?.[i]?.time ?? 0;
                questionDetails.times[playerName] = time.toFixed(2);
                if (time > 0) {
                    questionUsed = true;
                }
            }
    
            if (questionUsed) {
                results.comparative.push(questionDetails);
            }
        }
    }
    
    // Emit results to all players in the room
    io.to(roomName).emit('results', results);
    logWithTimestamp(`[Results Sent] to room: ${roomName}`);

    logWithTimestamp(`[Game Ended] Room: ${roomName}, Results:`, results);

    clearRoomData(roomName);
}

function displayPlayerStats(statsMessage) {
    logWithTimestamp(`[Stats] ${statsMessage}`);
}

server.listen(port, () => {
    logWithTimestamp(`Server running at http://localhost:${port}/`);
});
