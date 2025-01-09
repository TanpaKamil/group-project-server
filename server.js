const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        // origin: "http://localhost:5173",
        origin: "https://gp-onlinezoo.web.app",
        methods: ["GET", "POST"]
    }
});

// Enhanced animal state management
const animalState = {
    isHungry: true,
    isThirsty: true,
    isDirty: true,
    hasWaste: true,
    isBusy: false,
    currentActivity: null,
    activityQueue: [],
    lastUpdate: {
        fed: null,
        drink: null,
        wash: null,
        clean: null
    }
};

// Activity durations (in milliseconds)
const ACTIVITY_TIMINGS = {
    feed: 6500, 
    drink: 6500,
    wash: 6500, 
    clean: 6500,
    resetDelay: 7500
};

// Store active users with persistence
const activeUsers = new Map();

// Process the next activity in queue
const processNextActivity = () => {
    if (animalState.activityQueue.length === 0 || animalState.isBusy) {
        return;
    }

    const nextActivity = animalState.activityQueue.shift();
    executeActivity(nextActivity);
};

// Execute a single activity
const executeActivity = ({ action, socket, visitorName }) => {
    animalState.isBusy = true;
    animalState.currentActivity = action;
    io.emit('animal_state_update', animalState);

    // Update state based on action
    switch(action) {
        case 'feed':
            animalState.isHungry = false;
            animalState.lastUpdate.fed = new Date();
            break;
        case 'drink':
            animalState.isThirsty = false;
            animalState.lastUpdate.drink = new Date();
            break;
        case 'wash':
            animalState.isDirty = false;
            animalState.lastUpdate.wash = new Date();
            break;
        case 'clean':
            animalState.hasWaste = false;
            animalState.lastUpdate.clean = new Date();
            break;
    }

    // Emit state update and interaction event
    io.emit('animal_state_update', animalState);
    io.emit('interaction_event', { user: visitorName, action });

    // Schedule activity completion
    setTimeout(() => {
        animalState.isBusy = false;
        animalState.currentActivity = null;
        io.emit('animal_state_update', animalState);

        // Process next activity if any
        processNextActivity();
    }, ACTIVITY_TIMINGS[action]);

    // Schedule state reset
    setTimeout(() => {
        switch(action) {
            case 'feed':
                animalState.isHungry = true;
                break;
            case 'drink':
                animalState.isThirsty = true;
                break;
            case 'wash':
                animalState.isDirty = true;
                break;
            case 'clean':
                animalState.hasWaste = true;
                break;
        }
        animalState.lastUpdate[action] = null;
        io.emit('animal_state_update', animalState);
    }, ACTIVITY_TIMINGS.resetDelay);
};

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle visitor joining with persistence
    socket.on('join_room', (visitorData) => {
        const { visitorName, sessionId } = visitorData;
        
        // Store visitor data with session
        socket.data.visitorName = visitorName;
        socket.data.sessionId = sessionId;
        activeUsers.set(sessionId, { visitorName, socketId: socket.id });
        
        console.log('Join room:', { 
            socketId: socket.id, 
            visitorName,
            sessionId 
        });
        
        // Send current state to new user
        socket.emit('animal_state_update', animalState);
        
        io.emit('chat_message', {
            type: 'system',
            message: `${visitorName} has joined the zoo!`
        });
    });

    // Handle animal interactions with queuing
    socket.on('interact_animal', (action) => {
        const visitorName = socket.data.visitorName;
        
        if (!visitorName) {
            socket.emit('interaction_failed', 'User session not found');
            return;
        }

        console.log('Interaction requested:', {
            visitorName,
            action,
            socketId: socket.id
        });

        // Add activity to queue
        animalState.activityQueue.push({
            action,
            socket,
            visitorName
        });

        // Try to process next activity
        processNextActivity();
    });

    // Handle chat messages
    socket.on('send_message', (message) => {
        const visitorName = socket.data.visitorName;
        if (!visitorName) return;

        io.emit('chat_message', {
            type: 'user',
            user: visitorName,
            message: message
        });
    });

    // Handle reconnection
    socket.on('reconnect_session', (sessionId) => {
        const userData = activeUsers.get(sessionId);
        if (userData) {
            socket.data.visitorName = userData.visitorName;
            socket.data.sessionId = sessionId;
            activeUsers.set(sessionId, { ...userData, socketId: socket.id });
            socket.emit('session_restored', userData);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const visitorName = socket.data.visitorName;
        const sessionId = socket.data.sessionId;
        
        console.log('User disconnected:', { 
            socketId: socket.id, 
            visitorName,
            sessionId
        });
        
        if (visitorName) {
            io.emit('chat_message', {
                type: 'system',
                message: `${visitorName} has left the zoo!`
            });
        }
    });
});

// Basic health check route
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});