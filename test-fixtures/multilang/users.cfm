<cfcomponent>
    <!--- GOOD: valid query --->
    <cfquery name="getUser" datasource="mydb">
        SELECT u.UserId, u.Email, u.FirstName
        FROM auth.Users u
        WHERE u.UserId = <cfqueryparam value="#arguments.userId#" cfsqltype="cf_sql_integer">
    </cfquery>

    <!--- BAD: fake table --->
    <cfquery name="getLoginHistory" datasource="mydb">
        SELECT lh.UserId, lh.LoginDate, lh.IpAddress
        FROM auth.LoginHistory lh
        WHERE lh.UserId = <cfqueryparam value="#arguments.userId#" cfsqltype="cf_sql_integer">
    </cfquery>

    <!--- BAD: fake function --->
    <cfquery name="getDisplay" datasource="mydb">
        SELECT auth.fn_IsAdmin(#arguments.userId#) AS IsAdmin
    </cfquery>
</cfcomponent>
