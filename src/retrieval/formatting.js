/**
 * OpenVault Context Formatting
 *
 * Formats memories and relationships for injection into prompts.
 */

import { getContext } from '../../../../../extensions.js';
import { RELATIONSHIPS_KEY } from '../constants.js';

/**
 * Get relationship context for active characters
 * @param {Object} data - OpenVault data
 * @param {string} povCharacter - POV character name
 * @param {string[]} activeCharacters - List of active characters
 * @returns {Object[]} Array of relevant relationships
 */
export function getRelationshipContext(data, povCharacter, activeCharacters) {
    const relationships = data[RELATIONSHIPS_KEY] || {};
    const relevant = [];

    for (const [key, rel] of Object.entries(relationships)) {
        // Check if this relationship involves POV character and any active character
        const involvesPov = rel.character_a === povCharacter || rel.character_b === povCharacter;
        const involvesActive = activeCharacters.some(c =>
            c !== povCharacter && (rel.character_a === c || rel.character_b === c)
        );

        if (involvesPov && involvesActive) {
            const other = rel.character_a === povCharacter ? rel.character_b : rel.character_a;
            relevant.push({
                character: other,
                trust: rel.trust_level,
                tension: rel.tension_level,
                type: rel.relationship_type,
            });
        }
    }

    return relevant;
}

/**
 * Format context for injection into prompt
 * @param {Object[]} memories - Selected memories
 * @param {Object[]} relationships - Relevant relationships
 * @param {Object} emotionalInfo - Emotional state info { emotion, fromMessages }
 * @param {string} characterName - Character name for header
 * @param {number} tokenBudget - Maximum token budget
 * @returns {string} Formatted context string
 */
export function formatContextForInjection(memories, relationships, emotionalInfo, characterName, tokenBudget) {
    const lines = [];

    // Get current message number for context
    const context = getContext();
    const currentMessageNum = context.chat?.length || 0;

    lines.push(`[${characterName}'s Memory & State]`);
    lines.push(`(Current message: #${currentMessageNum})`);
    lines.push('');

    // Emotional state - handle both old string format and new object format
    const emotion = typeof emotionalInfo === 'string' ? emotionalInfo : emotionalInfo?.emotion;
    const fromMessages = typeof emotionalInfo === 'object' ? emotionalInfo?.fromMessages : null;

    if (emotion && emotion !== 'neutral') {
        let emotionLine = `Emotional state: ${emotion}`;
        if (fromMessages) {
            const { min, max } = fromMessages;
            emotionLine += min === max
                ? ` (as of msg #${min})`
                : ` (as of msgs #${min}-${max})`;
        }
        lines.push(emotionLine);
        lines.push('');
    }

    // Relationships
    if (relationships && relationships.length > 0) {
        lines.push('Relationships with present characters:');
        for (const rel of relationships) {
            const trustDesc = rel.trust >= 7 ? 'high trust' : rel.trust <= 3 ? 'low trust' : 'moderate trust';
            const tensionDesc = rel.tension >= 7 ? 'high tension' : rel.tension >= 4 ? 'some tension' : '';
            lines.push(`- ${rel.character}: ${rel.type || 'acquaintance'} (${trustDesc}${tensionDesc ? ', ' + tensionDesc : ''})`);
        }
        lines.push('');
    }

    // Memories - sorted by sequence (chronological order) with message numbers
    if (memories && memories.length > 0) {
        // Sort by sequence number (earlier events first)
        const sortedMemories = [...memories].sort((a, b) => {
            const seqA = a.sequence ?? a.created_at ?? 0;
            const seqB = b.sequence ?? b.created_at ?? 0;
            return seqA - seqB;
        });

        lines.push('Relevant memories (in chronological order, \u2605=minor to \u2605\u2605\u2605\u2605\u2605=critical):');
        sortedMemories.forEach((memory, index) => {
            const prefix = memory.is_secret ? '[Secret] ' : '';
            // Get message number(s) for this memory
            const msgIds = memory.message_ids || [];
            let msgLabel = '';
            if (msgIds.length === 1) {
                msgLabel = `(msg #${msgIds[0]})`;
            } else if (msgIds.length > 1) {
                const minMsg = Math.min(...msgIds);
                const maxMsg = Math.max(...msgIds);
                msgLabel = `(msgs #${minMsg}-${maxMsg})`;
            }
            // Importance indicator: star for each level (1-5)
            const importance = memory.importance || 3;
            const importanceLabel = '\u2605'.repeat(importance);
            lines.push(`${index + 1}. ${msgLabel} [${importanceLabel}] ${prefix}${memory.summary}`);
        });
    }

    lines.push(`[End ${characterName}'s Memory]`);

    // Rough token estimate (4 chars per token)
    let result = lines.join('\n');
    const estimatedTokens = result.length / 4;

    if (estimatedTokens > tokenBudget) {
        // Truncate memories if needed
        const overhead = (lines.slice(0, 5).join('\n').length + lines.slice(-1).join('\n').length) / 4;
        const availableForMemories = tokenBudget - overhead;

        const truncatedMemories = [];
        let currentTokens = 0;

        for (const memory of memories) {
            const memoryTokens = (memory.summary?.length || 0) / 4 + 5;
            if (currentTokens + memoryTokens <= availableForMemories) {
                truncatedMemories.push(memory);
                currentTokens += memoryTokens;
            } else {
                break;
            }
        }

        // Rebuild with truncated memories
        return formatContextForInjection(truncatedMemories, relationships, emotionalInfo, characterName, tokenBudget * 2);
    }

    return result;
}
