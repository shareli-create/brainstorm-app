// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// State management
let students = [];
let groups = [];
let activeSessions = {};
let submissions = {};
let groupSubmitters = {};
let groupActiveMembers = {};
let allSessionsCompleted = false;
let manualVerifications = {};

// Letter pairs for the task
const letterPairs = ['צנ', 'תד', 'קכ', 'עג', 'יח', 'לט', 'מץ', 'רס', 'סו', 'טר'];

// Verify celebrity names using Wikipedia API - IMPROVED
async function verifyCelebrity(name, letterPair, retries = 3) {
  try {
    const validPairs = ['צנ', 'תד', 'קכ', 'עג', 'יח', 'לט', 'מץ', 'רס', 'סו', 'טר'];
    
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
      return { 
        valid: false, 
        reason: 'חייב להכיל שם פרטי ושם משפחה',
        match: null,
        description: null
      };
    }

    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    const firstLetter = letterPair[0];
    const lastLetter = letterPair[1];
    
    // Check if letter pair is valid BEFORE checking Wikipedia
    if (!validPairs.includes(letterPair)) {
      return { 
        valid: false, 
        reason: `צמד האותיות ${letterPair} לא תקף. צמדים תקפים: ${validPairs.join(', ')}`,
        match: null,
        description: null
      };
    }
    
    if (firstName[0] !== firstLetter || lastName[0] !== lastLetter) {
      return { 
        valid: false, 
        reason: `שם פרטי צריך להתחיל ב-${firstLetter}, שם משפחה ב-${lastLetter}`,
        match: null,
        description: null
      };
    }

    // Create variations for foreign names (different transliterations)
    const createNameVariations = (first, last) => {
      const variations = new Set([`${first} ${last}`]);
      
      // Generic transliteration rules for Hebrew
      const applyTransliterationVariations = (word) => {
        const variants = new Set([word]);
        
        // Vowel variations (common in transliterations)
        const vowelRules = [
          { from: 'א', to: ['', 'א'] },
          { from: 'ו', to: ['ו', 'וו'] },
          { from: 'י', to: ['י', 'יי'] },
          { from: "ג'", to: ["ג'", 'ג׳', 'ג`', 'ג'] },
          { from: 'ג׳', to: ["ג'", 'ג׳', 'ג`', 'ג'] },
          { from: "ז'", to: ["ז'", 'ז׳', 'ז`', 'ז'] },
          { from: 'ז׳', to: ["ז'", 'ז׳', 'ז`', 'ז'] },
          { from: "ח'", to: ["ח'", 'ח׳', 'ח`', 'ח'] },
          { from: 'ח׳', to: ["ח'", 'ח׳', 'ח`', 'ח'] },
          { from: "צ'", to: ["צ'", 'צ׳', 'צ`', 'צ'] },
          { from: 'צ׳', to: ["צ'", 'צ׳', 'צ`', 'צ'] },
          { from: "ת'", to: ["ת'", 'ת׳', 'ת`', 'ת'] },
          { from: 'ת׳', to: ["ת'", 'ת׳', 'ת`', 'ת'] },
          { from: 'יי', to: ['י', 'יי'] },
          { from: 'וו', to: ['ו', 'וו'] },
          { from: 'אַ', to: ['א', 'אַ'] },
          { from: 'אָ', to: ['א', 'אָ', 'או'] },
          { from: 'או', to: ['או', 'אָ', 'ו', 'או'] },
          { from: 'יי', to: ['י', 'יי', 'אי'] },
        ];
        
        const currentVariants = Array.from(variants);
        currentVariants.forEach(variant => {
          vowelRules.forEach(rule => {
            if (variant.includes(rule.from)) {
              rule.to.forEach(replacement => {
                const newVariant = variant.replace(new RegExp(rule.from, 'g'), replacement);
                if (newVariant !== variant) {
                  variants.add(newVariant);
                }
              });
            }
          });
        });
        
        return Array.from(variants);
      };
      
      const firstVariants = applyTransliterationVariations(first);
      const lastVariants = applyTransliterationVariations(last);
      
      firstVariants.forEach(f => {
        lastVariants.forEach(l => {
          variations.add(`${f} ${l}`);
        });
      });
      
      const variationsArray = Array.from(variations);
      return variationsArray.slice(0, 15);
    };
    
    const nameVariations = createNameVariations(firstName, lastName);
    
    const searchQueries = [];
    nameVariations.forEach(variant => {
      searchQueries.push(variant);
      searchQueries.push(`"${variant}"`);
    });
    searchQueries.push(name);
    searchQueries.push(`"${name}"`);
    
    for (const query of searchQueries) {
      const searchUrl = `https://he.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=5`;
      
      try {
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        if (!data.query || !data.query.search || data.query.search.length === 0) {
          continue;
        }

        for (const result of data.query.search) {
          const title = result.title;
          const snippet = result.snippet.replace(/<[^>]*>/g, '');
          
          const titleLower = title.toLowerCase().trim();
          const nameLower = name.toLowerCase().trim();
          const firstNameLower = firstName.toLowerCase();
          const lastNameLower = lastName.toLowerCase();
          
          let titleContainsFirstName = titleLower.includes(firstNameLower);
          let titleContainsLastName = titleLower.includes(lastNameLower);
          
          nameVariations.forEach(variant => {
            const parts = variant.toLowerCase().split(/\s+/);
            if (titleLower.includes(parts[0])) titleContainsFirstName = true;
            if (titleLower.includes(parts[parts.length - 1])) titleContainsLastName = true;
          });
          
          const titleContainsBoth = titleContainsFirstName && titleContainsLastName;
          const exactMatch = titleLower === nameLower;
          const closeMatch = titleLower.includes(nameLower) || nameLower.includes(titleLower);
          
          if (exactMatch || titleContainsBoth || closeMatch) {
            const personIndicators = [
              '(נולד', '(נפטר', '(נ.', '(נולדה', '(נפטרה',
              'הייתה', 'היה', 'הייתה', 'היתה',
              'זמר', 'זמרת', 'שחקן', 'שחקנית', 'רב', 'רבנית',
              'פוליטיקאי', 'ספורטאי', 'כדורגלן', 'סופר', 'סופרת',
              'שר', 'שרה', 'ראש ממשלה', 'נשיא', 'נשיאה',
              'פרופסור', "ד\"ר", 'מנכ"ל', 'יזם', 'יזמית',
              'CEO', 'founder', 'מייסד', 'בעל', 'ח״כ'
            ];
            
            const hasPersonIndicator = personIndicators.some(indicator => 
              snippet.includes(indicator) || title.includes(indicator)
            );
            
            const hasYearPattern = snippet.match(/\b(19|20)\d{2}\b/) !== null;
            
            if (titleContainsBoth && (hasPersonIndicator || hasYearPattern)) {
              return {
                valid: true,
                match: title,
                reason: 'מאומת',
                description: snippet.substring(0, 200)
              };
            }
            
            if (exactMatch && hasPersonIndicator) {
              return {
                valid: true,
                match: title,
                reason: 'מאומת',
                description: snippet.substring(0, 200)
              };
            }
          }
        }
      } catch (fetchError) {
        console.error(`Search failed for query "${query}":`, fetchError);
        continue;
      }
      
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    const partialSearchUrl = `https://he.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&origin=*&srlimit=10`;
    
    try {
      const response = await fetch(partialSearchUrl);
      const data = await response.json();
      
      if (data.query && data.query.search && data.query.search.length > 0) {
        for (const result of data.query.search) {
          const title = result.title;
          const snippet = result.snippet.replace(/<[^>]*>/g, '');
          const titleLower = title.toLowerCase();
          const firstNameLower = firstName.toLowerCase();
          const lastNameLower = lastName.toLowerCase();
          
          const hasFirstName = titleLower.includes(firstNameLower);
          const hasLastName = titleLower.includes(lastNameLower);
          const hasPersonIndicator = ['נולד', 'נפטר', 'הייתה', 'היה', 'זמר', 'שחקן', 'רב', 'פוליטיקאי', 'ספורטאי', 'סופר', 'שר', 'נשיא', 'פרופסור', 'יזם', 'CEO'].some(indicator => 
            snippet.includes(indicator) || title.includes(indicator)
          );
          
          if ((hasFirstName || hasLastName) && hasPersonIndicator) {
            return {
              valid: 'manual_review',
              match: title,
              reason: 'דורש בדיקת מרצה',
              description: `נמצאה התאמה חלקית: "${title}". ${snippet.substring(0, 150)}`
            };
          }
        }
      }
    } catch (e) {
      console.error('Partial search error:', e);
    }
    
    return { 
      valid: false, 
      reason: 'לא נמצא בוויקיפדיה כאדם מפורסם',
      match: null,
      description: null
    };
    
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying ${name}... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return verifyCelebrity(name, letterPair, retries - 1);
    }
    
    console.error('Error verifying celebrity:', name, error);
    return { 
      valid: false, 
      reason: 'שגיאה בבדיקה',
      match: null,
      description: null
    };
  }
}

async function verifyCelebritiesForPair(names, letterPair) {
  const results = {};
  for (const name of names) {
    if (name && name.trim()) {
      const nameParts = name.trim().split(/\s+/);
      if (nameParts.length < 2) {
        results[name] = {
          valid: false,
          reason: 'חייב להכיל שם פרטי ושם משפחה',
          match: null,
          description: null
        };
        continue;
      }
      
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      const firstLetter = letterPair[0];
      const lastLetter = letterPair[1];
      
      if (firstName[0] !== firstLetter || lastName[0] !== lastLetter) {
        results[name] = {
          valid: false,
          reason: `לא מתאים לצמד ${letterPair}: ${firstName[0]}${lastName[0]} במקום ${firstLetter}${lastLetter}`,
          match: null,
          description: null
        };
        continue;
      }
      
      try {
        console.log(`Verifying: ${name}`);
        results[name] = await verifyCelebrity(name.trim(), letterPair);
        await new Promise(resolve => setTimeout(resolve, 600));
      } catch (error) {
        console.error(`Error verifying ${name}:`, error);
        results[name] = {
          valid: false,
          reason: 'שגיאה בבדיקה',
          match: null,
          description: null
        };
      }
    }
  }
  return results;
}

// REST API endpoints

// ✅ FIXED: Integer ID instead of float
app.post('/api/students/register', (req, res) => {
  const { name, skipDuplicateCheck } = req.body;
  
  console.log('📝 Registration request:', name);
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  if (!skipDuplicateCheck && students.some(s => s.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(400).json({ error: 'Name already exists' });
  }
  
  const student = {
    id: students.length > 0 ? Math.max(...students.map(s => s.id)) + 1 : 1, // ✅ INTEGER ID
    name: name.trim(),
    registeredAt: new Date()
  };
  
  students.push(student);
  
  console.log('✅ Student registered:', student);
  
  io.emit('studentsUpdated', students);
  res.json(student);
});

app.get('/api/students', (req, res) => {
  res.json(students);
});

app.delete('/api/students/:id', (req, res) => {
  const id = parseInt(req.params.id);
  students = students.filter(s => s.id !== id);
  io.emit('studentsUpdated', students);
  res.json({ success: true });
});

app.post('/api/groups', (req, res) => {
  const { type, memberIds } = req.body;
  const members = students.filter(s => memberIds.includes(s.id));
  
  if (members.length < 4) {
    return res.status(400).json({ error: 'Need at least 4 members' });
  }
  
  const group = {
    id: Date.now(),
    type,
    members,
    name: `קבוצה ${type === 'regular' ? 'רגילה' : 'נומינלית'} ${groups.length + 1}`
  };
  
  groups.push(group);
  io.emit('groupsUpdated', groups);
  res.json(group);
});

app.get('/api/groups', (req, res) => {
  res.json(groups);
});

app.delete('/api/groups/:id', (req, res) => {
  const id = parseInt(req.params.id);
  groups = groups.filter(g => g.id !== id);
  io.emit('groupsUpdated', groups);
  res.json({ success: true });
});

app.post('/api/session/start', (req, res) => {
  const { duration, groupIds } = req.body;
  
  const sessionGroups = groupIds && groupIds.length > 0 
    ? groups.filter(g => groupIds.includes(g.id))
    : groups;
  
  if (sessionGroups.length === 0) {
    return res.status(400).json({ error: 'No groups to start' });
  }
  
  const sessionId = Date.now();
  const session = {
    id: sessionId,
    groups: sessionGroups,
    duration,
    startTime: Date.now(),
    endTime: Date.now() + (duration * 1000),
    letterPairs,
    completed: false
  };
  
  activeSessions[sessionId] = session;
  allSessionsCompleted = false;
  
  io.emit('sessionStarted', session);
  res.json(session);
});

app.post('/api/session/end/:sessionId', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const session = activeSessions[sessionId];
  
  if (session) {
    session.completed = true;
    io.emit('sessionEnded', { sessionId: session.id });
    res.json({ success: true, sessionId });
  } else {
    res.status(400).json({ error: 'Session not found' });
  }
});

app.post('/api/sessions/complete-all', async (req, res) => {
  try {
    allSessionsCompleted = true;
    const results = await calculateAllResults();
    io.emit('allResultsReady', results);
    res.json(results);
  } catch (error) {
    console.error('Error calculating results:', error);
    res.status(500).json({ error: 'Failed to calculate results' });
  }
});

app.get('/api/session/:sessionId', (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  res.json(activeSessions[sessionId] || null);
});

app.get('/api/sessions/active', (req, res) => {
  res.json(Object.values(activeSessions).filter(s => !s.completed));
});

app.get('/api/sessions/all', (req, res) => {
  res.json(Object.values(activeSessions));
});

app.post('/api/submissions', async (req, res) => {
  const { studentId, groupId, answers } = req.body;
  
  if (groupId) {
    if (groupSubmitters[groupId] && groupSubmitters[groupId] !== studentId) {
      return res.status(403).json({ 
        error: 'Another group member already submitted',
        submitter: groupSubmitters[groupId]
      });
    }
    groupSubmitters[groupId] = studentId;
  }
  
  const key = groupId ? `group_${groupId}` : studentId;
  submissions[key] = answers;
  
  io.emit('submissionReceived', { key, studentId, groupId });
  res.json({ success: true });
});

app.get('/api/groups/:groupId/can-submit/:studentId', (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const studentId = parseInt(req.params.studentId);
  
  if (!groupActiveMembers[groupId]) {
    groupActiveMembers[groupId] = studentId;
    const student = students.find(s => s.id === studentId);
    res.json({ 
      canSubmit: true, 
      activeMember: student ? student.name : null,
      isActiveMember: true
    });
  } else if (groupActiveMembers[groupId] === studentId) {
    const student = students.find(s => s.id === studentId);
    res.json({ 
      canSubmit: true, 
      activeMember: student ? student.name : null,
      isActiveMember: true
    });
  } else {
    const activeMember = students.find(s => s.id === groupActiveMembers[groupId]);
    res.json({ 
      canSubmit: false, 
      activeMember: activeMember ? activeMember.name : 'חבר אחר בקבוצה',
      isActiveMember: false
    });
  }
});

app.get('/api/results', async (req, res) => {
  try {
    const results = await calculateAllResults();
    res.json(results);
  } catch (error) {
    console.error('Error getting results:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

app.post('/api/verify-name-manual', (req, res) => {
  const { name, isValid } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  manualVerifications[name] = {
    valid: isValid,
    reason: isValid ? 'מאומת ע"י מרצה' : 'נדחה ע"י מרצה',
    manuallyVerified: true,
    verifiedAt: new Date()
  };
  
  io.emit('manualVerificationUpdated', { name, verification: manualVerifications[name] });
  res.json({ success: true, verification: manualVerifications[name] });
});

app.post('/api/verify-name-manual/reset', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  delete manualVerifications[name];
  
  io.emit('manualVerificationUpdated', { name, verification: null });
  res.json({ success: true });
});

app.post('/api/reset', (req, res) => {
  students = [];
  groups = [];
  activeSessions = {};
  submissions = {};
  groupSubmitters = {};
  groupActiveMembers = {};
  allSessionsCompleted = false;
  manualVerifications = {};
  io.emit('systemReset');
  res.json({ success: true });
});

app.post('/api/test-names', async (req, res) => {
  const { names } = req.body;
  
  if (!names || !Array.isArray(names)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  const results = [];
  
  for (const item of names) {
    console.log(`Testing: ${item.name} for pair ${item.pair}`);
    const result = await verifyCelebrity(item.name, item.pair);
    results.push({
      name: item.name,
      pair: item.pair,
      result: result
    });
  }
  
  res.json(results);
});

async function calculateAllResults() {
  const groupResults = [];
  const summary = {
    regular: { groupCount: 0, memberCount: 0, verifiedNames: 0, avgPerMember: 0, avgPerGroup: 0 },
    nominal: { groupCount: 0, memberCount: 0, verifiedNames: 0, avgPerMember: 0, avgPerGroup: 0 }
  };
  
  for (const group of groups) {
    if (group.type === 'regular') {
      const groupAnswers = submissions[`group_${group.id}`] || {};
      
      const verificationResults = {};
      let totalValid = 0;
      
      const allNames = Object.values(groupAnswers).flat().filter(n => n && n.trim());
      const uniqueNames = [...new Set(allNames)];
      
      for (const pair of letterPairs) {
        const namesForPair = groupAnswers[pair] || [];
        const validNames = namesForPair.filter(name => name && name.trim());
        const uniquePairNames = [...new Set(validNames)];
        
        if (uniquePairNames.length > 0) {
          const pairResults = await verifyCelebritiesForPair(uniquePairNames, pair);
          Object.assign(verificationResults, pairResults);
        }
      }
      
      uniqueNames.forEach(name => {
        if (manualVerifications[name]) {
          verificationResults[name] = manualVerifications[name];
        }
      });
      
      uniqueNames.forEach(name => {
        if (verificationResults[name]?.valid === true) {
          totalValid++;
        }
      });
      
      const submitterId = groupSubmitters[group.id];
      const submitter = submitterId ? students.find(s => s.id === submitterId) : null;
      
      groupResults.push({
        groupId: group.id,
        groupName: group.name,
        type: 'regular',
        totalNames: uniqueNames.length,
        verifiedNames: totalValid,
        names: uniqueNames,
        verificationResults,
        avgPerMember: totalValid / group.members.length,
        memberCount: group.members.length,
        activeMember: submitter ? submitter.name : null
      });
      
      summary.regular.groupCount++;
      summary.regular.memberCount += group.members.length;
      summary.regular.verifiedNames += totalValid;
    } else {
      const allAnswersByPair = {};
      const memberSubmissions = {};
      const memberVerifiedCounts = {};
      const memberDetailedAnswers = {};
      
      group.members.forEach(member => {
        const memberAnswers = submissions[member.id] || {};
        let memberTotal = 0;
        memberDetailedAnswers[member.name] = [];
        
        letterPairs.forEach(pair => {
          if (!allAnswersByPair[pair]) {
            allAnswersByPair[pair] = [];
          }
          const pairAnswers = memberAnswers[pair] || [];
          const validAnswers = pairAnswers.filter(name => name && name.trim());
          allAnswersByPair[pair].push(...validAnswers);
          memberTotal += validAnswers.length;
          
          validAnswers.forEach(name => {
            memberDetailedAnswers[member.name].push(name);
          });
        });
        
        memberSubmissions[member.name] = memberTotal;
      });
      
      const verificationResults = {};
      let totalValid = 0;
      
      const allNames = Object.values(allAnswersByPair).flat().filter(n => n && n.trim());
      const uniqueNames = [...new Set(allNames)];
      
      for (const pair of letterPairs) {
        const namesForPair = allAnswersByPair[pair] || [];
        const uniquePairNames = [...new Set(namesForPair)];
        
        if (uniquePairNames.length > 0) {
          const pairResults = await verifyCelebritiesForPair(uniquePairNames, pair);
          Object.assign(verificationResults, pairResults);
        }
      }
      
      uniqueNames.forEach(name => {
        if (manualVerifications[name]) {
          verificationResults[name] = manualVerifications[name];
        }
      });
      
      uniqueNames.forEach(name => {
        if (verificationResults[name]?.valid === true) {
          totalValid++;
        }
      });
      
      group.members.forEach(member => {
        const memberNames = memberDetailedAnswers[member.name] || [];
        const uniqueMemberNames = [...new Set(memberNames)];
        let verifiedCount = 0;
        
        uniqueMemberNames.forEach(name => {
          if (verificationResults[name]?.valid === true) {
            verifiedCount++;
          }
        });
        
        memberVerifiedCounts[member.name] = verifiedCount;
      });
      
      groupResults.push({
        groupId: group.id,
        groupName: group.name,
        type: 'nominal',
        totalNames: uniqueNames.length,
        verifiedNames: totalValid,
        names: uniqueNames,
        verificationResults,
        avgPerMember: totalValid / group.members.length,
        memberCount: group.members.length,
        memberSubmissions,
        memberVerifiedCounts,
        memberDetailedAnswers
      });
      
      summary.nominal.groupCount++;
      summary.nominal.memberCount += group.members.length;
      summary.nominal.verifiedNames += totalValid;
    }
  }
  
  if (summary.regular.groupCount > 0) {
    summary.regular.avgPerGroup = summary.regular.verifiedNames / summary.regular.groupCount;
    summary.regular.avgPerMember = summary.regular.verifiedNames / summary.regular.memberCount;
  }
  if (summary.nominal.groupCount > 0) {
    summary.nominal.avgPerGroup = summary.nominal.verifiedNames / summary.nominal.groupCount;
    summary.nominal.avgPerMember = summary.nominal.verifiedNames / summary.nominal.memberCount;
  }
  
  return { groupResults, summary };
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.emit('initialState', {
    students: students,
    groups: groups,
    activeSessions: Object.values(activeSessions),
    letterPairs: letterPairs
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Student registration: http://localhost:${PORT}/register.html`);
  console.log(`Instructor interface: http://localhost:${PORT}/instructor.html`);
  console.log(`Student interface: http://localhost:${PORT}/student.html`);
});