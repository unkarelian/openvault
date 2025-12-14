/**
 * OpenVault Extraction Parser
 *
 * Parses LLM extraction results and updates character states and relationships.
 */

import { generateId, log } from '../utils.js';
import { CHARACTERS_KEY, RELATIONSHIPS_KEY } from '../constants.js';

/**
 * Parse extraction result from LLM
 * @param {string} jsonString - JSON string from LLM
 * @param {Array} messages - Source messages
 * @param {string} characterName - Character name
 * @param {string} userName - User name
 * @param {string} batchId - Unique batch ID for this extraction run
 * @returns {Array} Array of parsed event objects
 */
export function parseExtractionResult(jsonString, messages, characterName, userName, batchId = null) {
    try {
        // Extract JSON from response (handle markdown code blocks)
        let cleaned = jsonString;
        const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            cleaned = jsonMatch[1];
        }

        const parsed = JSON.parse(cleaned.trim());
        const events = Array.isArray(parsed) ? parsed : [parsed];

        // Get message IDs for sequence ordering
        const messageIds = messages.map(m => m.id);
        const minMessageId = Math.min(...messageIds);

        // Enrich events with metadata
        return events.map((event, index) => ({
            id: generateId(),
            ...event,
            message_ids: messageIds,
            // Sequence is based on the earliest message ID, with sub-index for multiple events from same batch
            sequence: minMessageId * 1000 + index,
            created_at: Date.now(),
            batch_id: batchId,
            characters_involved: event.characters_involved || [],
            witnesses: event.witnesses || event.characters_involved || [],
            location: event.location || 'unknown',
            is_secret: event.is_secret || false,
            importance: Math.min(5, Math.max(1, event.importance || 3)), // Clamp to 1-5, default 3
            emotional_impact: event.emotional_impact || {},
            relationship_impact: event.relationship_impact || {},
        }));
    } catch (error) {
        log(`Failed to parse extraction result: ${error.message}`);
        return [];
    }
}

/**
 * Update character states based on extracted events
 * @param {Array} events - Extracted events
 * @param {Object} data - OpenVault data object
 */
export function updateCharacterStatesFromEvents(events, data) {
    data[CHARACTERS_KEY] = data[CHARACTERS_KEY] || {};

    for (const event of events) {
        // Get message range for this event
        const messageIds = event.message_ids || [];
        const messageRange = messageIds.length > 0
            ? { min: Math.min(...messageIds), max: Math.max(...messageIds) }
            : null;

        // Update emotional impact
        if (event.emotional_impact) {
            for (const [charName, emotion] of Object.entries(event.emotional_impact)) {
                if (!data[CHARACTERS_KEY][charName]) {
                    data[CHARACTERS_KEY][charName] = {
                        name: charName,
                        current_emotion: 'neutral',
                        emotion_intensity: 5,
                        known_events: [],
                    };
                }

                // Update emotion and track which messages it's from
                data[CHARACTERS_KEY][charName].current_emotion = emotion;
                data[CHARACTERS_KEY][charName].last_updated = Date.now();
                if (messageRange) {
                    data[CHARACTERS_KEY][charName].emotion_from_messages = messageRange;
                }
            }
        }

        // Add event to witnesses' knowledge
        for (const witness of (event.witnesses || [])) {
            if (!data[CHARACTERS_KEY][witness]) {
                data[CHARACTERS_KEY][witness] = {
                    name: witness,
                    current_emotion: 'neutral',
                    emotion_intensity: 5,
                    known_events: [],
                };
            }
            if (!data[CHARACTERS_KEY][witness].known_events.includes(event.id)) {
                data[CHARACTERS_KEY][witness].known_events.push(event.id);
            }
        }
    }
}

/**
 * Update relationships based on extracted events
 * @param {Array} events - Extracted events
 * @param {Object} data - OpenVault data object
 */
export function updateRelationshipsFromEvents(events, data) {
    data[RELATIONSHIPS_KEY] = data[RELATIONSHIPS_KEY] || {};

    for (const event of events) {
        if (event.relationship_impact) {
            for (const [relationKey, impact] of Object.entries(event.relationship_impact)) {
                // Parse relationship key (e.g., "Alice->Bob")
                const match = relationKey.match(/^(.+?)\s*->\s*(.+)$/);
                if (!match) continue;

                const [, charA, charB] = match;
                const key = `${charA}<->${charB}`;

                if (!data[RELATIONSHIPS_KEY][key]) {
                    data[RELATIONSHIPS_KEY][key] = {
                        character_a: charA,
                        character_b: charB,
                        trust_level: 5,
                        tension_level: 0,
                        relationship_type: 'acquaintance',
                        history: [],
                    };
                }

                // Update based on impact description
                const impactLower = impact.toLowerCase();
                if (impactLower.includes('trust') && impactLower.includes('increas')) {
                    data[RELATIONSHIPS_KEY][key].trust_level = Math.min(10, data[RELATIONSHIPS_KEY][key].trust_level + 1);
                } else if (impactLower.includes('trust') && impactLower.includes('decreas')) {
                    data[RELATIONSHIPS_KEY][key].trust_level = Math.max(0, data[RELATIONSHIPS_KEY][key].trust_level - 1);
                }

                if (impactLower.includes('tension') && impactLower.includes('increas')) {
                    data[RELATIONSHIPS_KEY][key].tension_level = Math.min(10, data[RELATIONSHIPS_KEY][key].tension_level + 1);
                } else if (impactLower.includes('tension') && impactLower.includes('decreas')) {
                    data[RELATIONSHIPS_KEY][key].tension_level = Math.max(0, data[RELATIONSHIPS_KEY][key].tension_level - 1);
                }

                // Add to history
                data[RELATIONSHIPS_KEY][key].history.push({
                    event_id: event.id,
                    impact: impact,
                    timestamp: Date.now(),
                });
            }
        }
    }
}
