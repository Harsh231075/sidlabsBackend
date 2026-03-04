/**
 * Reset Database + Seed Base Users (Cognito-only)
 *
 * This script:
 * 1) Deletes all users from MongoDB
 * 2) Seeds 3 base users (admin, moderator, patient) WITHOUT passwords
 *
 * On first successful AWS Cognito login, the user will be auto-linked by email
 * and the user's Cognito `sub` will be stored in MongoDB.
 *
 * Run: node scripts/resetAndSeedCognito.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('../src/db/index');
const User = require('../src/models/User');

const BASE_USERS = [
  {
    _id: 'u-admin',
    name: 'Admin',
    email: 'admin@winsights.life',
    passwordHash: null,
    role: 'admin-user',
    roleType: 'admin',
    authProvider: 'cognito',
    isPatient: false,
    disease: '',
    caregiverRelationship: '',
    location: '',
    bio: '',
    avatarUrl: '',
    suspended: false,
  },
  {
    _id: 'u-moderator',
    name: 'Moderator',
    email: 'moderator@winsights.life',
    passwordHash: null,
    role: 'moderator-user',
    roleType: 'moderator',
    authProvider: 'cognito',
    isPatient: false,
    disease: '',
    caregiverRelationship: '',
    location: '',
    bio: '',
    avatarUrl: '',
    suspended: false,
  },
  {
    _id: 'u-patient-sarah',
    name: 'Sarah',
    email: 'sarah@winsights.life',
    passwordHash: null,
    role: 'patient-user',
    roleType: 'patient',
    authProvider: 'cognito',
    isPatient: true,
    disease: '',
    caregiverRelationship: '',
    location: '',
    bio: '',
    avatarUrl: '',
    suspended: false,
  },
];

async function resetAndSeed() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');

    console.log('\n🗑️  Dropping all users...');
    const deleteResult = await User.deleteMany({});
    console.log(`   Deleted ${deleteResult.deletedCount} users`);

    console.log('\n🌱 Seeding base users (no passwords)...');
    const now = new Date();
    for (const u of BASE_USERS) {
      const created = await User.create({
        ...u,
        email: String(u.email).trim().toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
      console.log(`   ✅ Seeded: ${created.email} (${created.role})`);
    }

    console.log('\n✅ Database reset + seeded successfully.');
    console.log('\n💡 Next: login from UI using AWS Cognito credentials.');
    console.log('   The server will auto-link the MongoDB user and store cognitoSub.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

resetAndSeed();
