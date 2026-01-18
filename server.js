import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "marvelrivalsapi";

dotenv.config();

const { API } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const api = new API(process.env.MARVEL_RIVALS_KEY);

function capWords(str) {
    // 1. Split the string into an array of words
    const words = str.split(' ');
  
    // 2. Map over the array, capitalizing the first letter of each word
    const capitalizedWords = words.map(word => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  
    // 3. Join the array back into a single string with spaces
    return capitalizedWords.join(' ');
  }
  
/**
 * Utility: Get top unranked hero for a single player
 */
function getTopUnrankedHero(playerData) {
    const heroes = playerData?.heroes_unranked;

    if (!Array.isArray(heroes) || heroes.length === 0) {
        return null;
    }

    const eligibleHeroes = heroes
        .filter(hero => hero.matches > 10)
        .map(hero => ({
            heroName: capWords(hero.hero_name),
            matches: hero.matches,
            wins: hero.wins,
            winRate: hero.wins / hero.matches
        }));

    if (eligibleHeroes.length === 0) {
        return null;
    }

    return eligibleHeroes.reduce((best, current) =>
        current.winRate > best.winRate ? current : best
    );
}

/**
 * Utility: Combine unranked hero stats across multiple players
 */
function combineUnrankedHeroes(playersData) {
    const heroMap = new Map();

    for (const playerData of playersData) {
        const heroes = playerData?.heroes_unranked || [];

        for (const hero of heroes) {
            if (hero.matches <= 10) continue;

            const key = capWords(hero.hero_name);

            if (!heroMap.has(key)) {
                heroMap.set(key, {
                    hero: key,
                    matches: 0,
                    wins: 0
                });
            }

            const entry = heroMap.get(key);
            entry.matches += hero.matches;
            entry.wins += hero.wins;
        }
    }

    return [...heroMap.values()]
        .map(h => ({
            ...h,
            winRate: h.wins / h.matches
        }))
        .sort((a, b) => b.winRate - a.winRate);
}

/**
 * Route: Top hero for a single player
 * GET /api/player/:username/top-hero?season=5
 */
app.get("/api/player/:username/top-hero", async (req, res) => {
    try {
        const filters = {};
        if (req.query.season) {
            filters.season = Number(req.query.season);
        }

        const playerData = await api.player.getPlayerStats(
            req.params.username,
            filters
        );

        const topHero = getTopUnrankedHero(playerData);

        if (!topHero) {
            return res.json({
                message: "No unranked hero with more than 10 matches"
            });
        }

        res.json({
            player: req.params.username,
            hero: topHero.heroName,
            matches: topHero.matches,
            wins: topHero.wins,
            winRate: Number((topHero.winRate * 100).toFixed(2))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Route: Combined top hero across multiple players
 * GET /api/top-hero/combined?players=a;b;c&season=5
 */
app.get("/api/top-hero/combined", async (req, res) => {
    try {
        const playersParam = req.query.players;
        if (!playersParam) {
            return res.status(400).json({
                error: "players query parameter is required"
            });
        }

        const players = playersParam
            .split(";")
            .map(p => p.trim())
            .filter(Boolean);

        if (players.length === 0) {
            return res.status(400).json({
                error: "No valid players provided"
            });
        }

        const filters = {};
        if (req.query.season) {
            filters.season = Number(req.query.season);
        }

        // Fetch all players in parallel
        const playerDataList = await Promise.all(
            players.map(async (player) => {
                try {
                    return await api.player.getPlayerStats(player, filters);
                } catch (err) {
                    // Skip players with private or missing data
                    if (err.status === 403 || err.status === 404) {
                        console.warn(`Skipping player ${player}: ${err.status}`);
                        return null;
                    }
                    // Unexpected error → rethrow
                    throw err;
                }
            })
        );
        // Remove failed players
        const validPlayerData = playerDataList.filter(Boolean);

        const combinedHeroes = combineUnrankedHeroes(validPlayerData);

        if (combinedHeroes.length === 0) {
            return res.json({
                message: "No eligible hero data found"
            });
        }

        const topHero = combinedHeroes[0];

        res.json({
            players,
            hero: topHero.hero,
            matches: topHero.matches,
            wins: topHero.wins,
            winRate: Number((topHero.winRate * 100).toFixed(2))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Server start
 */
const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});