---@diagnostic disable: redundant-parameter
---@class OxAccountServer : OxClass
local OxAccount = lib.class('OxAccount')

function OxAccount:__index(index)
    local value = OxAccount[index] --[[@as any]]

    if type(value) == 'function' then
        self[index] = value == OxAccount.__call and function(...)
            return value(self, index, ...)
        end or function(...)
            return value(self, ...)
        end

        return self[index]
    end

    return value
end

function OxAccount:constructor(data)
    for k, v in pairs(data) do
        self[k] = v
    end
end

function OxAccount:__call(...)
    return exports.fox_core:CallAccount(self.accountId, ...)
end

function OxAccount:__tostring()
    return json.encode(self, { indent = true })
end

--[[ Calling a not-yet-registered export throws ("No such export ..."), aborting
     the consumer's require. Guard it so a load-order/timing gap only skips the
     dynamic proxy methods instead of hard-crashing. ]]
local ok, calls = pcall(function() return exports.fox_core:GetAccountCalls() end)

if not ok then
    print(('^3[fox_core]^0 GetAccountCalls() unavailable (%s); dynamic OxAccount methods skipped'):format(calls))
    calls = nil
end

for method in pairs(calls or {}) do
    if not rawget(OxAccount, method) then OxAccount[method] = OxAccount.__call end
end

local function CreateAccountInstance(account)
    if not account then return end

    return OxAccount:new(account)
end

---@class OxServer
local Ox = Ox

function Ox.GetAccount(accountId)
    local account = exports.fox_core:GetAccount(accountId)
    return CreateAccountInstance(account)
end

function Ox.GetCharacterAccount(charId)
    local account = exports.fox_core:GetCharacterAccount(charId)
    return CreateAccountInstance(account)
end

function Ox.GetGroupAccount(groupName)
    local account = exports.fox_core:GetGroupAccount(groupName)
    return CreateAccountInstance(account)
end

function Ox.CreateAccount(owner, label)
    local account = exports.fox_core:CreateAccount(owner, label)
    return CreateAccountInstance(account)
end
