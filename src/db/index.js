const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const maxPoolSizeRaw = process.env.MONGO_MAX_POOL_SIZE;
        const minPoolSizeRaw = process.env.MONGO_MIN_POOL_SIZE;
        const maxPoolSize = Number.isFinite(Number(maxPoolSizeRaw)) ? Number(maxPoolSizeRaw) : 50;
        const minPoolSize = Number.isFinite(Number(minPoolSizeRaw)) ? Number(minPoolSizeRaw) : 5;

        const serverSelectionTimeoutMS = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000);
        const connectTimeoutMS = Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000);
        const socketTimeoutMS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);

        const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/winsights', {
            maxPoolSize,
            minPoolSize,
            serverSelectionTimeoutMS,
            connectTimeoutMS,
            socketTimeoutMS,
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
