/**
 * Quick test script for moderation service
 * Run with: node test-moderation.js
 */

const { scan } = require('./src/services/moderationService');

async function testModeration() {
  console.log('=== Testing Moderation Service ===\n');

  const testCases = [
    {
      name: 'High PHI - Phone Number',
      text: 'Call me at 555-123-4567 for more details',
    },
    {
      name: 'High PHI - Email',
      text: 'Contact me at john.doe@example.com',
    },
    {
      name: 'High PHI - SSN',
      text: 'My SSN is 123-45-6789',
    },
    {
      name: 'High Spam - Repeated Characters',
      text: 'BUY NOW!!!!! LIMITED TIME!!!!!',
    },
    {
      name: 'High Sales Pitch',
      text: 'Buy now! Special offer! DM me for deals! Limited time!',
    },
    {
      name: 'High Toxicity',
      text: 'This is stupid and hateful content',
    },
    {
      name: 'Suspicious Links',
      text: 'Check out this link: http://bit.ly/scam-site',
    },
    {
      name: 'Normal Content',
      text: 'Thanks for sharing this helpful information!',
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n--- Test: ${testCase.name} ---`);
    console.log(`Text: "${testCase.text}"`);
    
    try {
      const result = await scan({
        text: testCase.text,
        userId: 'test-user-id',
        context: { type: 'post' },
      });

      console.log(`Status: ${result.status}`);
      console.log('Scores:', {
        phi: result.scores.phi_score.toFixed(2),
        spam: result.scores.spam_score.toFixed(2),
        sales: result.scores.sales_pitch_score.toFixed(2),
        toxicity: result.scores.toxicity_score.toFixed(2),
        links: result.scores.link_risk_score.toFixed(2),
        trust: result.scores.user_trust_score.toFixed(2),
      });
      console.log('Flags:', result.flags.join(', ') || 'None');
      if (result.detectedSpans.length > 0) {
        console.log('Detected Spans:', result.detectedSpans.map(s => s.text).join(', '));
      }
    } catch (error) {
      console.error('Error:', error.message);
    }
  }

  console.log('\n=== Test Complete ===');
}

// Run tests
testModeration().catch(console.error);

