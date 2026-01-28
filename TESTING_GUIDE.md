# Testing Guide: Configuration Persistence

## Prerequisites

Ensure eva4j is linked locally:
```bash
cd c:\Documentos\eva4j
npm link
```

## Test Suite

### Test 1: Create New Project with Configuration

**Steps**:
```bash
# Navigate to test directory
cd c:\temp

# Create new project
eva4j create test-shop

# Follow prompts:
# - Group ID: com.test
# - Java version: 21
# - Dependencies: web, data-jpa, validation
```

**Expected Results**:
- ✅ Project created successfully
- ✅ File `c:\temp\test-shop\.eva4j.json` exists
- ✅ File contains project configuration
- ✅ `createdAt` and `updatedAt` timestamps are set
- ✅ `modules` array is empty

**Verification**:
```bash
cd test-shop
type .eva4j.json
```

Should see:
```json
{
  "projectName": "test-shop",
  "groupId": "com.test",
  "artifactId": "test-shop",
  "packageName": "com.test.testshop",
  "javaVersion": "21",
  "springBootVersion": "3.5.5",
  "springModulithVersion": "1.4.6",
  "dependencies": ["web", "data-jpa", "validation"],
  "modules": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

### Test 2: View Project Info

**Steps**:
```bash
cd c:\temp\test-shop
eva4j info
```

**Expected Results**:
```
📦 Eva4j Project Information

Project Details:
  Name:              test-shop
  Group ID:          com.test
  Artifact ID:       test-shop
  Package:           com.test.testshop

Versions:
  Java:              21
  Spring Boot:       3.5.5
  Spring Modulith:   1.4.6

Dependencies:
  • web
  • data-jpa
  • validation

Modules:
  No modules added yet

Timestamps:
  Created:           ...
  Last Updated:      ...
```

---

### Test 3: Add First Module (Creates Shared)

**Steps**:
```bash
cd c:\temp\test-shop
eva4j add module user

# Follow prompts:
# - Enable soft delete? Yes
# - Enable audit fields? Yes
```

**Expected Results**:
- ✅ "First module! Creating shared module..." message
- ✅ Shared module created
- ✅ User module created
- ✅ "Configuration saved to .eva4j.json" message
- ✅ .eva4j.json updated with user module

**Verification**:
```bash
type .eva4j.json
```

Should show:
```json
{
  ...,
  "modules": [
    {
      "name": "user",
      "hasSoftDelete": true,
      "hasAudit": true,
      "createdAt": "..."
    }
  ],
  "updatedAt": "..."  // This should be newer than createdAt
}
```

---

### Test 4: Add Second Module

**Steps**:
```bash
eva4j add module product

# Follow prompts:
# - Enable soft delete? No
# - Enable audit fields? Yes
```

**Expected Results**:
- ✅ No "First module" message (shared already exists)
- ✅ Product module created
- ✅ Configuration updated

**Verification**:
```bash
eva4j info
```

Should show:
```
Modules:
  • user (soft-delete, audit)
  • product (audit)
```

---

### Test 5: Duplicate Module Prevention

**Steps**:
```bash
eva4j add module user
```

**Expected Results**:
- ❌ Error: "Module 'user' is already registered"
- ❌ Module not created
- ❌ Process exits with code 1

---

### Test 6: Persistence Across Sessions

**Steps**:
```bash
# Close current terminal
# Open NEW terminal

cd c:\temp\test-shop
eva4j info
```

**Expected Results**:
- ✅ All project information displays correctly
- ✅ All modules shown (user, product)
- ✅ Module options preserved

**Add Another Module**:
```bash
eva4j add module order
```

**Expected Results**:
- ✅ Works without any re-initialization
- ✅ Module added successfully
- ✅ Configuration persisted

---

### Test 7: Info Command Outside Project

**Steps**:
```bash
cd c:\temp
eva4j info
```

**Expected Results**:
- ❌ Error: "Not in an eva4j project directory"
- ❌ Helpful message shown

---

### Test 8: Configuration File Integrity

**Steps**:
```bash
cd c:\temp\test-shop

# Backup
copy .eva4j.json .eva4j.json.backup

# Corrupt the file
echo { > .eva4j.json

# Try to add module
eva4j add module test
```

**Expected Results**:
- ❌ Error about corrupted configuration
- Process handles gracefully

**Restore**:
```bash
copy .eva4j.json.backup .eva4j.json
```

---

### Test 9: Git Integration

**Steps**:
```bash
cd c:\temp\test-shop

# Initialize git
git init
git add .
git status
```

**Expected Results**:
- ✅ .eva4j.json is staged (not ignored)
- ✅ .gitignore includes comment about .eva4j.json

**Verification**:
```bash
type .gitignore | findstr "eva4j"
```

Should show comment about tracking .eva4j.json

---

### Test 10: Module Directory Structure Matches Config

**Steps**:
```bash
cd c:\temp\test-shop
eva4j info

# Note module names from output
# Then check filesystem
```

**Verification**:
```bash
dir src\main\java\com\test\testshop /b
```

Should show:
- TestShopApplication.java
- shared/
- user/
- product/
- order/

All modules from .eva4j.json should have directories.

---

## Test Checklist

- [ ] Test 1: Project creation with .eva4j.json
- [ ] Test 2: Info command displays correctly
- [ ] Test 3: First module creates shared + updates config
- [ ] Test 4: Second module updates config correctly
- [ ] Test 5: Duplicate prevention works
- [ ] Test 6: Persistence across terminal sessions
- [ ] Test 7: Error handling outside project
- [ ] Test 8: Handles corrupted configuration
- [ ] Test 9: Git integration correct
- [ ] Test 10: Filesystem matches configuration

## Common Issues

### Issue: .eva4j.json not created
**Solution**: Check base-generator.js includes saveProjectConfig() call

### Issue: Modules not tracked
**Solution**: Check add-module.js includes configManager.addModule() call

### Issue: Info command not found
**Solution**: Check bin/eva4j.js registers info command

### Issue: Configuration not loading
**Solution**: Check ConfigManager.loadProjectConfig() handles errors properly

## Success Criteria

All tests pass with expected results:
- ✅ Configuration persists across sessions
- ✅ Modules tracked correctly with options
- ✅ Info command displays accurate information
- ✅ Duplicate prevention works
- ✅ Error handling is graceful
- ✅ Git integration correct
- ✅ Timestamps update properly

## Cleanup

After testing:
```bash
cd c:\temp
rmdir /s /q test-shop
```
