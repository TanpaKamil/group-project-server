const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Constants
const ACTIVITY_TIMINGS = {
    feed: 6500,
    drink: 6500,
    wash: 6500,
    clean: 6500,
    resetDelay: 7500
};

class AnimalManager {
    constructor() {
        this.state = {
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
    }

    queueActivity(activity) {
        this.state.activityQueue.push(activity);
    }

    processNextActivity(io) {
        if (this.state.activityQueue.length === 0 || this.state.isBusy) {
            return;
        }

        const activity = this.state.activityQueue.shift();
        this.executeActivity(activity, io);
    }

    executeActivity({ action, visitorName }, io) {
        this.state.isBusy = true;
        this.state.currentActivity = action;

        // Update state based on action
        switch (action) {
            case 'feed':
                this.state.isHungry = false;
                break;
            case 'drink':
                this.state.isThirsty = false;
                break;
            case 'wash':
                this.state.isDirty = false;
                break;
            case 'clean':
                this.state.hasWaste = false;
                break;
        }

        this.state.lastUpdate[action] = new Date();
        io.emit('animal_state_update', this.state);
        io.emit('interaction_event', { user: visitorName, action });

        // Schedule activity completion
        setTimeout(() => {
            this.state.isBusy = false;
            this.state.currentActivity = null;
            io.emit('animal_state_update', this.state);
            this.processNextActivity(io);
        }, ACTIVITY_TIMINGS[action]);

        // Schedule state reset
        setTimeout(() => {
            switch (action) {
                case 'feed':
                    this.state.isHungry = true;
                    break;
                case 'drink':
                    this.state.isThirsty = true;
                    break;
                case 'wash':
                    this.state.isDirty = true;
                    break;
                case 'clean':
                    this.state.hasWaste = true;
                    break;
            }
            this.state.lastUpdate[action] = null;
            io.emit('animal_state_update', this.state);
        }, ACTIVITY_TIMINGS.resetDelay);
    }
}

class UserManager {
    constructor() {
        this.activeUsers = new Map();
        this.connectedSessions = new Set();
    }

    addUser(sessionId, userData) {
        this.activeUsers.set(sessionId, userData);
        this.connectedSessions.add(sessionId);
    }

    removeUser(sessionId) {
        this.activeUsers.delete(sessionId);
        this.connectedSessions.delete(sessionId);
    }

    isSessionConnected(sessionId) {
        return this.connectedSessions.has(sessionId);
    }

    getUser(sessionId) {
        return this.activeUsers.get(sessionId);
    }
}

// Initialize Express and Socket.IO
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: " https://gp-onlinezoo.web.app/",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Initialize managers
const animalManager = new AnimalManager();
const userManager = new UserManager();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Handle visitor joining
    socket.on('join_room', (visitorData) => {
        const { visitorName, sessionId } = visitorData;

        if (!sessionId || !visitorName) {
            socket.emit('error', 'Invalid session data');
            return;
        }

        // Prevent duplicate connections
        if (userManager.isSessionConnected(sessionId)) {
            socket.emit('error', 'Session already connected');
            return;
        }

        // Store user data
        socket.data.sessionId = sessionId;
        socket.data.visitorName = visitorName;
        userManager.addUser(sessionId, { visitorName, socketId: socket.id });

        // Send initial state and welcome message
        socket.emit('animal_state_update', animalManager.state);
        io.emit('chat_message', {
            type: 'system',
            message: `${visitorName} has joined the zoo!`
        });

        console.log('User joined:', { sessionId, visitorName, socketId: socket.id });
    });

    // Handle animal interactions
    socket.on('interact_animal', (action) => {
        const { sessionId, visitorName } = socket.data;

        if (!sessionId || !visitorName) {
            socket.emit('error', 'Not authenticated');
            return;
        }

        console.log('Interaction:', { action, visitorName, socketId: socket.id });

        animalManager.queueActivity({ action, visitorName });
        animalManager.processNextActivity(io);
    });

    // Handle chat messages
    socket.on('send_message', (message) => {
        const { visitorName } = socket.data;
        
        if (!visitorName || !message.trim()) {
            return;
        }

        io.emit('chat_message', {
            type: 'user',
            user: visitorName,
            message: message.trim()
        });
    });

    // Handle session reconnection
    socket.on('reconnect_session', (sessionId) => {
        const userData = userManager.getUser(sessionId);
        if (userData) {
            socket.data.sessionId = sessionId;
            socket.data.visitorName = userData.visitorName;
            userManager.addUser(sessionId, { ...userData, socketId: socket.id });
            socket.emit('session_restored', userData);
            console.log('Session restored:', { sessionId, userData });
        }
    });

    // Handle heartbeat
    socket.on('heartbeat', () => {
        socket.emit('heartbeat_response');
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const { sessionId, visitorName } = socket.data;

        if (sessionId) {
            userManager.removeUser(sessionId);

            if (visitorName) {
                io.emit('chat_message', {
                    type: 'system',
                    message: `${visitorName} has left the zoo!`
                });
            }

            console.log('User disconnected:', { sessionId, visitorName, socketId: socket.id });
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        activeUsers: userManager.activeUsers.size,
        queueLength: animalManager.state.activityQueue.length
    });
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});